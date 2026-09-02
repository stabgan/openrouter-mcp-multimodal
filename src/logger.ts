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
const BEARER = /Bearer\s+\S+/gi;
const DATA_URL = /^data:[^;]+;base64,/i;

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
  return value.replace(BEARER, 'Bearer [REDACTED]').replace(SK_OR_KEY, '[REDACTED]');
}

function sanitizeCtx(
  ctx: Record<string, unknown>,
  seen = new WeakSet<object>(),
): Record<string, unknown> {
  if (seen.has(ctx)) return { note: 'circular' };
  seen.add(ctx);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    out[key] = sanitizeLogValue(key, value, seen);
  }
  return out;
}

function sanitizeLogValue(key: string, value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value, key);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeLogValue(`${key}[${index}]`, item, seen));
  }
  if (value && typeof value === 'object') {
    return sanitizeCtx(value as Record<string, unknown>, seen);
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
