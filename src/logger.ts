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

function currentLevel(): LogLevel {
  const raw = (process.env.OPENROUTER_LOG_LEVEL ?? '').toLowerCase();
  if (raw === 'error' || raw === 'warn' || raw === 'info' || raw === 'debug') return raw;
  return 'info';
}

/** Low-level write hook, replaceable in tests. */
export const _sink = {
  write(line: string): void {
    process.stderr.write(line + '\n');
  },
};

export function log(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] > LEVEL_ORDER[currentLevel()]) return;
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (ctx) record.ctx = ctx;
  try {
    _sink.write(JSON.stringify(record));
  } catch {
    _sink.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg,
        ctx: { note: 'unserializable' },
      }),
    );
  }
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
    if (ctx) record.ctx = ctx;
    try {
      _sink.write(JSON.stringify(record));
    } catch {
      _sink.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'audit',
          msg,
          ctx: { note: 'unserializable' },
        }),
      );
    }
  },
};
