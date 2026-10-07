/**
 * Hard cap on sanitized error message length. Upstream errors can be
 * arbitrarily large (e.g. HTML error pages that slip past the HTML check,
 * or verbose JSON bodies); this prevents oversized MCP tool results.
 */
const MAX_SANITIZED_ERROR_LENGTH = 2048;

/**
 * Pre-truncate input before running regex replacements. Upstream SDK errors
 * can include full response bodies (HTML pages, large JSON payloads) that
 * would cause the redaction regexes to scan megabytes of text for no benefit
 * — the final output is capped at MAX_SANITIZED_ERROR_LENGTH anyway.
 *
 * The multiplier provides enough headroom for redaction markers (which are
 * shorter than the content they replace) to not displace useful text from
 * the first MAX_SANITIZED_ERROR_LENGTH chars of output.
 */
const MAX_SANITIZE_INPUT_LENGTH = MAX_SANITIZED_ERROR_LENGTH * 4;

/**
 * Strip bearer tokens, API key material, embedded data URLs, large base64
 * blobs, and overly long messages from user-visible output.
 *
 * Used by both `toolErrorFrom` (catch-all error handler) and
 * `classifyUpstreamError` to ensure no error path leaks credentials or
 * oversized binary payloads into MCP tool results.
 */
export function sanitizeErrorMessage(msg: string): string {
  const bounded =
    msg.length > MAX_SANITIZE_INPUT_LENGTH ? msg.slice(0, MAX_SANITIZE_INPUT_LENGTH) : msg;

  let sanitized = bounded
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/sk-or-v\d+-[\w-]+/gi, '[REDACTED]')
    .replace(/sk-[\w-]{20,}/gi, '[REDACTED]')
    .replace(/Authorization:\s*\S+/gi, 'Authorization: [REDACTED]')
    // Redact data URLs — they carry inline binary payloads (images, audio).
    .replace(/data:[^;,\s]+(?:;[^;,\s]+)*;base64,[A-Za-z0-9+/=_-]{64,}/g, '[REDACTED data-url]')
    // Redact bare base64 blobs ≥ 256 chars (same heuristic as logger).
    .replace(
      /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{256,}(?![A-Za-z0-9+/=_-])/g,
      (match) => `[REDACTED base64 ${match.length} chars]`,
    );

  if (sanitized.length > MAX_SANITIZED_ERROR_LENGTH) {
    sanitized =
      sanitized.slice(0, MAX_SANITIZED_ERROR_LENGTH) +
      `… [truncated — ${sanitized.length - MAX_SANITIZED_ERROR_LENGTH} chars omitted]`;
  }

  return sanitized;
}

export const ErrorCode = {
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNSAFE_PATH: 'UNSAFE_PATH',
  UPSTREAM_HTTP: 'UPSTREAM_HTTP',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  UPSTREAM_REFUSED: 'UPSTREAM_REFUSED',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  RESOURCE_TOO_LARGE: 'RESOURCE_TOO_LARGE',
  ZDR_INCOMPATIBLE: 'ZDR_INCOMPATIBLE',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  JOB_FAILED: 'JOB_FAILED',
  JOB_STILL_RUNNING: 'JOB_STILL_RUNNING',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ToolErrorMeta = {
  code: ErrorCode;
  details?: Record<string, unknown>;
  suggestions?: string[];
  retry_after_seconds?: number;
} & Record<string, unknown>;

export type ToolErrorResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
  _meta: ToolErrorMeta;
} & Record<string, unknown>;

export interface ToolErrorOptions {
  suggestions?: string[];
  retry_after_seconds?: number;
}

export function toolError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  opts?: ToolErrorOptions,
): ToolErrorResult {
  const meta: ToolErrorMeta = { code };
  if (details !== undefined) meta.details = details;
  if (opts?.suggestions && opts.suggestions.length > 0) meta.suggestions = opts.suggestions;
  if (typeof opts?.retry_after_seconds === 'number') {
    meta.retry_after_seconds = opts.retry_after_seconds;
  }
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    _meta: meta,
  };
}

export function toolErrorFrom(
  code: ErrorCode,
  err: unknown,
  prefix?: string,
  opts?: ToolErrorOptions,
): ToolErrorResult {
  const base = prefix ? `${prefix}: ` : '';
  if (err instanceof Error)
    return toolError(code, sanitizeErrorMessage(base + err.message), undefined, opts);
  if (typeof err === 'string')
    return toolError(code, sanitizeErrorMessage(base + err), undefined, opts);
  return toolError(code, sanitizeErrorMessage(base + 'unknown error'), undefined, opts);
}
