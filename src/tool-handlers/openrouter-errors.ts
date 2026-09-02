/**
 * Map OpenRouter / OpenAI SDK errors to our closed `ErrorCode` enum.
 */
import { ErrorCode, toolError, type ToolErrorResult } from '../errors.js';

interface SdkLikeError {
  status?: number;
  code?: number | string;
  message?: string;
  error?: { message?: string; code?: number | string; type?: string; error_type?: string } | string;
  headers?: { get?: (name: string) => string | null } | Record<string, string>;
  response?: { headers?: { get?: (name: string) => string | null } | Record<string, string> };
}

const AUTH_SUGGESTIONS = [
  'Verify OPENROUTER_API_KEY is set and matches https://openrouter.ai/keys',
  'Ensure the key has not been revoked or expired',
] as const;

/** Strip bearer tokens and OpenRouter key material from user-visible messages. */
export function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/sk-or-v\d+-[\w-]+/gi, '[REDACTED]')
    .replace(/Authorization:\s*\S+/gi, 'Authorization: [REDACTED]');
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
  const asInt = parseInt(raw, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    const deltaSec = Math.ceil((asDate - Date.now()) / 1000);
    return deltaSec > 0 ? deltaSec : 0;
  }
  return undefined;
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as SdkLikeError;
  if (typeof e.status === 'number') return e.status;
  if (typeof e.code === 'number') return e.code;
  if (typeof e.code === 'string' && /^\d{3}$/.test(e.code)) return parseInt(e.code, 10);
  const nested = e.error;
  if (nested && typeof nested === 'object' && typeof nested.code === 'number') return nested.code;
  if (err instanceof Error) {
    const m = err.message.match(/\bHTTP (\d{3})\b/);
    if (m) return parseInt(m[1]!, 10);
  }
  return undefined;
}

function extractNestedError(err: unknown): SdkLikeError['error'] | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const nested = (err as SdkLikeError).error;
  if (!nested) return undefined;
  return nested;
}

function extractMessage(err: unknown): string {
  let msg: string;
  if (err instanceof Error) {
    const nested = extractNestedError(err);
    if (nested && typeof nested === 'object' && typeof nested.message === 'string') {
      msg = `${err.message} — ${nested.message}`;
    } else if (typeof nested === 'string') {
      msg = `${err.message} — ${nested}`;
    } else {
      msg = err.message;
    }
  } else if (typeof err === 'string') {
    msg = err;
  } else if (typeof err === 'object' && err !== null) {
    const e = err as SdkLikeError;
    if (typeof e.message === 'string') {
      msg = e.message;
    } else {
      const nested = extractNestedError(err);
      if (nested && typeof nested === 'object' && typeof nested.message === 'string') {
        msg = nested.message;
      } else if (typeof nested === 'string') {
        msg = nested;
      } else {
        msg = 'unknown error';
      }
    }
  } else {
    msg = 'unknown error';
  }
  return sanitizeErrorMessage(msg);
}

function extractErrorType(err: unknown): string | undefined {
  const nested = extractNestedError(err);
  if (nested && typeof nested === 'object') {
    if (typeof nested.error_type === 'string') return nested.error_type;
    if (typeof nested.type === 'string') return nested.type;
  }
  return undefined;
}

function isAuthFailure(
  status: number | undefined,
  lower: string,
  errorType: string | undefined,
): boolean {
  if (status === 401) return true;
  if (errorType === 'authentication' || errorType === 'authentication_error') return true;
  return (
    lower.includes('invalid api key') ||
    lower.includes('invalid credentials') ||
    lower.includes('invalid authentication') ||
    lower.includes('no auth credentials') ||
    lower.includes('missing api key') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication failed') ||
    lower.includes('user not found') ||
    (status === 403 &&
      (lower.includes('invalid api key') ||
        lower.includes('invalid credentials') ||
        lower.includes('authentication')))
  );
}

function isModelNotFound(status: number | undefined, lower: string): boolean {
  if (status === 404) return true;
  return (
    lower.includes('model') &&
    (lower.includes('does not exist') ||
      lower.includes('not found') ||
      lower.includes('invalid model'))
  );
}

function isGuardrailOrPolicy(lower: string): boolean {
  return (
    lower.includes('content policy') ||
    lower.includes('moderation') ||
    lower.includes('refused') ||
    lower.includes('prompt injection') ||
    lower.includes('guardrail') ||
    lower.includes('request blocked') ||
    lower.includes('blocked:')
  );
}

function looksLikeHtml(msg: string): boolean {
  const t = msg.trimStart().toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html');
}

/** Classify upstream errors into the closed `ErrorCode` set. */
export function classifyUpstreamError(err: unknown, contextMessage?: string): ToolErrorResult {
  const rawMsg = extractMessage(err);
  const status = extractStatus(err);
  const errorType = extractErrorType(err);
  const lower = rawMsg.toLowerCase();
  const fullMsg = contextMessage ? `${contextMessage}: ${rawMsg}` : rawMsg;
  const retryAfterSeconds = extractRetryAfterSeconds(err);

  if (looksLikeHtml(rawMsg)) {
    return toolError(
      ErrorCode.UPSTREAM_HTTP,
      contextMessage
        ? `${contextMessage}: upstream returned an HTML error page`
        : 'upstream returned an HTML error page',
      { status },
      { suggestions: ['Retry after a brief delay', 'Check https://status.openrouter.ai'] },
    );
  }

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

  if (isModelNotFound(status, lower)) {
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

  if (isAuthFailure(status, lower, errorType)) {
    return toolError(
      ErrorCode.INVALID_CREDENTIALS,
      fullMsg,
      { status, reason: 'auth' },
      { suggestions: [...AUTH_SUGGESTIONS] },
    );
  }

  if (isGuardrailOrPolicy(lower) || status === 403) {
    return toolError(
      ErrorCode.UPSTREAM_REFUSED,
      fullMsg,
      { status, reason: 'policy' },
      {
        suggestions: ['Rephrase the prompt', 'Try a different provider via provider.order'],
      },
    );
  }

  if (typeof status === 'number' && status >= 400 && status < 500) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      fullMsg,
      { status },
      {
        suggestions: ['Verify request parameters against OpenRouter docs'],
      },
    );
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
