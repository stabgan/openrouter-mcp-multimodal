/**
 * Map OpenRouter / OpenAI SDK errors to our closed `ErrorCode` enum.
 */
import { ErrorCode, toolError, type ToolErrorResult } from '../errors.js';

interface SdkLikeError {
  status?: number;
  code?: number | string;
  message?: string;
  error?: { message?: string; code?: number | string } | string;
  /**
   * Some SDK shapes expose the raw Response headers on the error, which
   * we read to pull `Retry-After` on 429 responses.
   */
  headers?: { get?: (name: string) => string | null } | Record<string, string>;
  response?: { headers?: { get?: (name: string) => string | null } | Record<string, string> };
}

function extractRetryAfterSeconds(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as SdkLikeError;
  const getHeader = (
    h: { get?: (name: string) => string | null } | Record<string, string> | undefined,
  ): string | null => {
    if (!h) return null;
    if (typeof h === 'object' && typeof (h as { get?: unknown }).get === 'function') {
      return (h as { get: (name: string) => string | null }).get('retry-after') ?? null;
    }
    const rec = h as Record<string, string>;
    return rec['retry-after'] ?? rec['Retry-After'] ?? null;
  };
  const raw = getHeader(e.headers) ?? getHeader(e.response?.headers);
  if (!raw) return undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  return undefined;
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const s = (err as SdkLikeError).status;
  if (typeof s === 'number') return s;
  const c = (err as SdkLikeError).code;
  if (typeof c === 'number') return c;
  if (typeof c === 'string' && /^\d{3}$/.test(c)) return parseInt(c, 10);
  if (err instanceof Error) {
    const m = err.message.match(/\bHTTP (\d{3})\b/);
    if (m) return parseInt(m[1]!, 10);
  }
  return undefined;
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) {
    const nested = (err as unknown as SdkLikeError).error;
    if (nested && typeof nested === 'object' && typeof nested.message === 'string') {
      return `${err.message} — ${nested.message}`;
    }
    if (typeof nested === 'string') return `${err.message} — ${nested}`;
    return err.message;
  }
  if (typeof err === 'string') return err;
  return 'unknown error';
}

/** Classify upstream errors into the closed `ErrorCode` set. */
export function classifyUpstreamError(err: unknown, contextMessage?: string): ToolErrorResult {
  const rawMsg = extractMessage(err);
  const status = extractStatus(err);
  const lower = rawMsg.toLowerCase();
  const fullMsg = contextMessage ? `${contextMessage}: ${rawMsg}` : rawMsg;
  const retryAfterSeconds = extractRetryAfterSeconds(err);

  if (
    lower.includes('insufficient balance') ||
    lower.includes('insufficient credits') ||
    lower.includes('requires more credits') ||
    lower.includes('requires at least') ||
    status === 402
  ) {
    return toolError(
      ErrorCode.UPSTREAM_REFUSED,
      fullMsg,
      { status, reason: 'credits' },
      {
        suggestions: [
          'Top up credits at https://openrouter.ai/settings/credits',
          'Switch to a free-tier model (append :free to the slug)',
        ],
      },
    );
  }

  if (lower.includes('zdr') || lower.includes('zero data retention')) {
    return toolError(
      ErrorCode.ZDR_INCOMPATIBLE,
      fullMsg,
      { status },
      {
        suggestions: [
          'Pick a provider that supports your ZDR policy',
          'Set provider.data_collection: "allow" to bypass the restriction',
        ],
      },
    );
  }

  if (
    lower.includes('model') &&
    (lower.includes('does not exist') ||
      lower.includes('not found') ||
      lower.includes('invalid model'))
  ) {
    return toolError(
      ErrorCode.MODEL_NOT_FOUND,
      fullMsg,
      { status },
      {
        suggestions: [
          'Use search_models to discover valid model ids',
          'Use validate_model to pre-flight a model id',
        ],
      },
    );
  }

  if (
    lower.includes('content policy') ||
    lower.includes('moderation') ||
    lower.includes('refused')
  ) {
    return toolError(
      ErrorCode.UPSTREAM_REFUSED,
      fullMsg,
      { status, reason: 'policy' },
      {
        suggestions: ['Rephrase the prompt', 'Try a different provider via provider.order'],
      },
    );
  }

  if (status === 429 || lower.includes('rate limit')) {
    return toolError(
      ErrorCode.UPSTREAM_REFUSED,
      fullMsg,
      { status, reason: 'rate_limit' },
      {
        suggestions: [
          retryAfterSeconds !== undefined
            ? `Wait ${retryAfterSeconds}s and retry`
            : 'Wait and retry with exponential backoff',
          'Append :nitro to the model slug to route to a faster provider',
        ],
        retry_after_seconds: retryAfterSeconds,
      },
    );
  }

  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('aborted') ||
    (err instanceof Error && (err as { name?: string }).name === 'AbortError')
  ) {
    return toolError(
      ErrorCode.UPSTREAM_TIMEOUT,
      fullMsg,
      { status },
      {
        suggestions: ['Retry', 'Raise max_wait_ms or max_tokens'],
      },
    );
  }

  if (typeof status === 'number' && status >= 400 && status < 500) {
    return toolError(ErrorCode.INVALID_INPUT, fullMsg, { status });
  }

  if (typeof status === 'number' && status >= 500) {
    return toolError(
      ErrorCode.UPSTREAM_HTTP,
      fullMsg,
      { status },
      {
        suggestions: ['Retry after a brief delay', 'Check https://status.openrouter.ai'],
        retry_after_seconds: retryAfterSeconds,
      },
    );
  }

  return toolError(ErrorCode.UPSTREAM_HTTP, fullMsg);
}
