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
  if (err instanceof Error) return toolError(code, base + err.message, undefined, opts);
  if (typeof err === 'string') return toolError(code, base + err, undefined, opts);
  return toolError(code, base + 'unknown error', undefined, opts);
}
