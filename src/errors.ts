/**
 * Closed error-code taxonomy for MCP tool responses. Every handler uses
 * `toolError(code, message, details?, opts?)` instead of ad-hoc text so
 * clients can switch on `_meta.code` without regex-parsing free text.
 *
 * Adding a new code requires a design.md note — this set is intentionally
 * small and stable.
 */
export const ErrorCode = {
  INVALID_INPUT: 'INVALID_INPUT',
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

export interface ToolErrorMeta {
  code: ErrorCode;
  details?: Record<string, unknown>;
  /**
   * Optional human-readable next steps the agent can take. Inspired by
   * the Apigene "structured errors" best practice: rather than a raw
   * string for the agent to interpret, list concrete options like
   * "Wait and retry" or "Lower resolution to 480p".
   */
  suggestions?: string[];
  /**
   * For rate-limit / backoff errors, the number of seconds the caller
   * should wait before retrying. Derived from `Retry-After` headers when
   * available.
   */
  retry_after_seconds?: number;
}

export interface ToolErrorResult {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
  _meta: ToolErrorMeta;
}

export interface ToolErrorOptions {
  suggestions?: string[];
  retry_after_seconds?: number;
}

/** Build a structured MCP error result. */
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

/**
 * Convert a caught `unknown` error into a structured tool result. Preserves
 * user-visible messages for known `Error` types and refuses to leak stack
 * traces or raw objects.
 */
export function toolErrorFrom(
  code: ErrorCode,
  err: unknown,
  prefix?: string,
  opts?: ToolErrorOptions,
): ToolErrorResult {
  const base = prefix ? `${prefix}: ` : '';
  if (err instanceof Error) return toolError(code, base + err.message, undefined, opts);
  if (typeof err === 'string') return toolError(code, base + err, undefined, opts);
  return toolError(code, base + 'unknown error', undefined, opts);
}
