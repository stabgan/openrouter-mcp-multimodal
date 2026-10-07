/**
 * Map OpenRouter / OpenAI SDK errors to our closed `ErrorCode` enum.
 */
import {
  ErrorCode,
  sanitizeErrorMessage,
  toolError,
  toolErrorFrom,
  type ToolErrorResult,
} from '../errors.js';
import { UnsafePathError } from './path-safety.js';

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

/**
 * Extract the Node.js / system-level error `code` property (e.g.
 * `'ECONNREFUSED'`, `'ENOTFOUND'`, `'ECONNRESET'`).  The OpenAI SDK
 * preserves the original `cause` chain, so we walk up to two levels deep.
 *
 * Using the code property directly is more robust than relying on it
 * appearing inside the error message string — SDK wrappers may rephrase
 * the message while the code stays stable.
 */
function extractNodeErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { code?: unknown; cause?: unknown };
  if (typeof e.code === 'string' && e.code.length > 0 && !/^\d{3}$/.test(e.code)) {
    return e.code;
  }
  // Walk `cause` — the OpenAI SDK wraps transport errors as `cause`.
  if (e.cause && typeof e.cause === 'object') {
    const cause = e.cause as { code?: unknown };
    if (typeof cause.code === 'string' && cause.code.length > 0 && !/^\d{3}$/.test(cause.code)) {
      return cause.code;
    }
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

/** Match Node.js TLS/OpenSSL error codes and common certificate keywords. */
function isTlsCertificateError(lower: string): boolean {
  return (
    lower.includes('self_signed_cert') ||
    lower.includes('self signed cert') ||
    lower.includes('depth_zero_self_signed') ||
    lower.includes('unable_to_verify_leaf_signature') ||
    lower.includes('unable_to_get_issuer_cert') ||
    lower.includes('cert_has_expired') ||
    lower.includes('cert_not_yet_valid') ||
    lower.includes('cert_signature_failure') ||
    lower.includes('cert_rejected') ||
    lower.includes('err_tls_cert_altname_invalid') ||
    lower.includes('certificate has expired') ||
    lower.includes('certificate is not yet valid') ||
    lower.includes('unable to verify the first certificate')
  );
}

function looksLikeHtml(msg: string): boolean {
  const t = msg.trimStart().toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html');
}

/** Match context-window / token-limit errors from various OpenRouter providers. */
function isContextLengthExceeded(lower: string): boolean {
  return (
    lower.includes('context_length_exceeded') ||
    lower.includes('context length exceeded') ||
    lower.includes('context window') ||
    lower.includes('maximum context length') ||
    lower.includes('token limit') ||
    lower.includes('too many tokens') ||
    lower.includes('input is too long') ||
    lower.includes('exceeds the model') ||
    lower.includes('prompt is too long')
  );
}

/** Classify upstream errors into the closed `ErrorCode` set. */
export function classifyUpstreamError(err: unknown, contextMessage?: string): ToolErrorResult {
  const rawMsg = extractMessage(err);
  const status = extractStatus(err);
  const errorType = extractErrorType(err);
  const nodeCode = extractNodeErrorCode(err);
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
    // Catch AbortSignal-based cancellations ("The operation was aborted")
    // but not ECONNABORTED which is a connection interruption, not a timeout.
    // Use the specific DOMException phrasing to avoid false-positives from
    // upstream messages like "request aborted by content filter".
    (lower.includes('operation was aborted') &&
      !lower.includes('econnaborted') &&
      nodeCode !== 'ECONNABORTED') ||
    (err instanceof Error && (err as { name?: string }).name === 'AbortError') ||
    nodeCode === 'ETIMEDOUT' ||
    nodeCode === 'UND_ERR_CONNECT_TIMEOUT'
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

  // Network-level failures — DNS resolution, connection refused, host/network unreachable.
  // Must precede the guardrail/policy check because ECONNREFUSED contains "refused".
  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('enetunreach') ||
    lower.includes('ehostunreach') ||
    nodeCode === 'ECONNREFUSED' ||
    nodeCode === 'ENOTFOUND' ||
    nodeCode === 'ENETUNREACH' ||
    nodeCode === 'EHOSTUNREACH'
  ) {
    return toolError(
      ErrorCode.UPSTREAM_REFUSED,
      fullMsg,
      { status, reason: 'network' },
      {
        suggestions: [
          'Verify internet connectivity',
          'Check https://status.openrouter.ai for outages',
          'Retry after a brief delay',
        ],
      },
    );
  }

  // Temporary DNS resolution failures — unlike ENOTFOUND (permanent), EAI_AGAIN is
  // transient and usually resolves on retry. Common during brief network hiccups or
  // DNS server overload.
  if (lower.includes('eai_again') || nodeCode === 'EAI_AGAIN') {
    return toolError(
      ErrorCode.UPSTREAM_REFUSED,
      fullMsg,
      { status, reason: 'dns_transient' },
      {
        suggestions: [
          'Retry — DNS resolution temporarily failed',
          'Verify internet connectivity',
          'Check https://status.openrouter.ai for outages',
        ],
      },
    );
  }

  // Transient connection interruptions — socket reset, broken pipe, hang-up,
  // or connection aborted by the local or remote side.
  if (
    lower.includes('econnreset') ||
    lower.includes('epipe') ||
    lower.includes('socket hang up') ||
    lower.includes('econnaborted') ||
    nodeCode === 'ECONNRESET' ||
    nodeCode === 'EPIPE' ||
    nodeCode === 'ECONNABORTED'
  ) {
    return toolError(
      ErrorCode.UPSTREAM_HTTP,
      fullMsg,
      { status, reason: 'connection_reset' },
      {
        suggestions: [
          'Retry — the connection was interrupted',
          'Check https://status.openrouter.ai for outages',
        ],
      },
    );
  }

  // TLS/SSL certificate errors — common behind corporate proxies or with
  // misconfigured intermediate certs.  Must precede the guardrail/policy
  // check so that cert-related "refused" messages are not misclassified.
  if (isTlsCertificateError(lower)) {
    return toolError(
      ErrorCode.UPSTREAM_REFUSED,
      fullMsg,
      { status, reason: 'tls' },
      {
        suggestions: [
          'If behind a corporate proxy, set NODE_EXTRA_CA_CERTS to the proxy CA bundle',
          'Verify system clock is correct (certificate validity is time-sensitive)',
          'Check https://status.openrouter.ai for outages',
        ],
      },
    );
  }

  // TLS protocol errors — version mismatches, cipher suite incompatibilities,
  // or corrupted TLS handshakes. Common behind corporate proxies that
  // intercept HTTPS traffic with incompatible TLS settings.
  if (lower.includes('eproto') || lower.includes('ssl routines') || nodeCode === 'EPROTO') {
    return toolError(
      ErrorCode.UPSTREAM_REFUSED,
      fullMsg,
      { status, reason: 'tls' },
      {
        suggestions: [
          'If behind a corporate proxy, verify TLS interception settings',
          'Ensure Node.js TLS version is compatible (TLS 1.2+ required)',
          'Set NODE_EXTRA_CA_CERTS if the proxy uses a custom CA',
          'Check https://status.openrouter.ai for outages',
        ],
      },
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

  if (status === 408) {
    return toolError(
      ErrorCode.UPSTREAM_TIMEOUT,
      fullMsg,
      { status },
      {
        suggestions: ['Retry', 'Raise max_wait_ms or max_tokens'],
      },
    );
  }

  if (status === 413 || lower.includes('payload too large') || lower.includes('body too large')) {
    return toolError(
      ErrorCode.RESOURCE_TOO_LARGE,
      fullMsg,
      { status },
      {
        suggestions: [
          'Reduce the size of input images, audio, or video',
          'Use save_path to reference local files instead of inlining large payloads',
        ],
      },
    );
  }

  // Context-window / token-limit exceeded — one of the most common user errors.
  // Must precede the generic 4xx handler so the caller gets actionable suggestions
  // instead of the catch-all "Verify request parameters against OpenRouter docs".
  if (isContextLengthExceeded(lower)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      fullMsg,
      { status, reason: 'context_length' },
      {
        suggestions: [
          'Reduce the number or size of messages in the conversation',
          'Use a model with a larger context window (use get_model_info to check context_length)',
          'Summarize earlier messages before appending new ones',
        ],
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

/**
 * Classify errors from resource-loading operations (image, audio, video reads).
 *
 * Multiple tool handlers need to load user-supplied file references — local
 * paths, HTTP(S) URLs, and data URLs — and translate fetch / sandbox errors
 * into the closed `ErrorCode` taxonomy. This centralises the heuristic so
 * every handler classifies the same root cause the same way.
 *
 * Handles: path-sandbox violations, SSRF blocks, oversized resources,
 * timeouts, unsupported formats, and generic input errors.
 */
export function classifyResourceLoadError(err: unknown, prefix?: string): ToolErrorResult {
  if (err instanceof UnsafePathError) {
    return toolErrorFrom(ErrorCode.UNSAFE_PATH, err, prefix);
  }
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // 'Blocked host' is thrown by the SSRF guard with exact casing.
  if (msg.includes('Blocked host')) {
    return toolErrorFrom(ErrorCode.UPSTREAM_REFUSED, err, prefix);
  }
  if (lower.includes('too large')) {
    return toolErrorFrom(ErrorCode.RESOURCE_TOO_LARGE, err, prefix);
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return toolErrorFrom(ErrorCode.UPSTREAM_TIMEOUT, err, prefix);
  }
  if (
    lower.includes('unsupported') ||
    lower.includes('not a video') ||
    lower.includes('invalid data url')
  ) {
    return toolErrorFrom(ErrorCode.UNSUPPORTED_FORMAT, err, prefix);
  }
  return toolErrorFrom(ErrorCode.INVALID_INPUT, err, prefix);
}
