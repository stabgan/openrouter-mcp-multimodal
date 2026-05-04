/**
 * Stderr-bound JSON line logger. stdout is the MCP transport so logs MUST
 * go to stderr or the client will choke. Output is one JSON object per line:
 *
 *   {"ts":"2026-04-20T14:03:10.123Z","level":"info","msg":"job_submitted",
 *    "ctx":{"model":"google/veo-3.1","id":"vid_abc"}}
 *
 * Level is filtered by OPENROUTER_LOG_LEVEL (error|warn|info|debug,
 * default info). Unknown values fall through to info.
 *
 * `audit` is a special level that ALWAYS writes (bypasses the level filter),
 * intended for cost-incurring / destructive operations so operators can
 * trace them after the fact.
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
    // Fall back to a short-form record if `ctx` contains something unserializable.
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
  /**
   * Always-on audit line. Bypasses OPENROUTER_LOG_LEVEL. Use for paid or
   * destructive operations (generate_video, generate_audio, generate_image)
   * so operators can trace unintended spend via `docker logs` or a log
   * aggregator.
   */
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
