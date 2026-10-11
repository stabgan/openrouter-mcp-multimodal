/**
 * Stderr-bound JSON line logger. stdout is reserved for MCP transport.
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const SENSITIVE_KEY = /^(authorization|api[_-]?key|bearer|token|secret|password)$/i;
const SK_OR_KEY = /sk-or-v\d+-[\w-]+/gi;
const SK_GENERIC_KEY = /sk-[\w-]{20,}/gi;
const BEARER = /Bearer\s+\S+/gi;
const DATA_URL = /^data:[^;]+(?:;[^;]+)*;base64,/i;

function currentLevel(): LogLevel {
  const raw = (process.env.OPENROUTER_LOG_LEVEL ?? '').toLowerCase();
  if (raw === 'error' || raw === 'warn' || raw === 'info' || raw === 'debug') return raw;
  return 'info';
}

function redactString(value: string, key?: string): string {
  if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (DATA_URL.test(value)) return `[REDACTED data-url ${value.length} chars]`;
  if (value.length > 256 && /^[A-Za-z0-9+/=_-]+$/.test(value)) {
    return `[REDACTED base64 ${value.length} chars]`;
  }
  return value
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(SK_OR_KEY, '[REDACTED]')
    .replace(SK_GENERIC_KEY, '[REDACTED]');
}

/**
 * Maximum recursion depth for log-context sanitization.  Every other
 * recursive function in the codebase has a depth cap (`hasDeepUnsafeKey`
 * in decide.ts: 32, `sanitizePersistedMeta` in async-chat.ts: 2 levels).
 * Without this limit, a deeply nested non-circular object reaching the
 * logger could overflow the call stack, crashing the MCP server (DoS).
 *
 * 32 matches the ceiling used by the decide handler's state validator —
 * generous for any real log context while preventing pathological inputs.
 */
const MAX_LOG_SANITIZE_DEPTH = 32;

function sanitizeCtx(
  ctx: Record<string, unknown>,
  seen = new WeakSet<object>(),
  depth = MAX_LOG_SANITIZE_DEPTH,
): Record<string, unknown> {
  if (depth <= 0) return { note: 'depth limit' };
  if (seen.has(ctx)) return { note: 'circular' };
  seen.add(ctx);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    // Guard against prototype pollution from untrusted JSON input.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = sanitizeLogValue(key, value, seen, depth - 1);
  }
  return out;
}

function sanitizeLogValue(
  key: string,
  value: unknown,
  seen = new WeakSet<object>(),
  depth = MAX_LOG_SANITIZE_DEPTH,
): unknown {
  if (typeof value === 'string') return redactString(value, key);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth <= 0) return '[depth limit]';
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeLogValue(`${key}[${index}]`, item, seen, depth - 1));
  }
  if (value && typeof value === 'object') {
    return sanitizeCtx(value as Record<string, unknown>, seen, depth);
  }
  return value;
}

/** Low-level write hook, replaceable in tests. */
export const _sink = {
  write(line: string): void {
    process.stderr.write(line + '\n');
  },
};

function emitRecord(record: Record<string, unknown>): void {
  try {
    _sink.write(JSON.stringify(record));
  } catch {
    _sink.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: record.level,
        msg: record.msg,
        ctx: { note: 'unserializable' },
      }),
    );
  }
}

export function log(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] > LEVEL_ORDER[currentLevel()]) return;
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (ctx) record.ctx = sanitizeCtx(ctx);
  emitRecord(record);
}

export const logger = {
  error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, ctx),
  audit(msg: string, ctx?: Record<string, unknown>): void {
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: 'audit',
      msg,
    };
    if (ctx) record.ctx = sanitizeCtx(ctx);
    emitRecord(record);
  },
};
