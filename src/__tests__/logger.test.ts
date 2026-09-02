import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { log, logger, _sink } from '../logger.js';

describe('logger', () => {
  const lines: string[] = [];
  const origWrite = _sink.write;

  beforeEach(() => {
    lines.length = 0;
    _sink.write = (line: string) => {
      lines.push(line);
    };
  });

  afterEach(() => {
    _sink.write = origWrite;
    vi.unstubAllEnvs();
  });

  it('emits one JSON line per call', () => {
    log('info', 'hello');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('merges ctx object', () => {
    log('warn', 'boom', { id: 42 });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx).toEqual({ id: 42 });
  });

  it('filters below the configured level', () => {
    vi.stubEnv('OPENROUTER_LOG_LEVEL', 'warn');
    log('info', 'should not appear');
    log('debug', 'also no');
    log('warn', 'yes');
    log('error', 'yes');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).msg).toBe('yes');
    expect(JSON.parse(lines[1]!).level).toBe('error');
  });

  it('unknown level env falls back to info', () => {
    vi.stubEnv('OPENROUTER_LOG_LEVEL', 'chatty');
    log('info', 'hi');
    log('debug', 'no');
    expect(lines).toHaveLength(1);
  });

  it('short-circuits unserializable ctx', () => {
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    log('info', 'broken', circ);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx).toEqual({ self: { note: 'circular' } });
  });

  it('exposes logger.error/warn/info/debug helpers', () => {
    logger.error('a');
    logger.warn('b');
    logger.info('c');
    logger.debug('d');
    const levels = lines.map((l) => JSON.parse(l).level);
    // default level is info, so debug is filtered
    expect(levels).toEqual(['error', 'warn', 'info']);
  });

  it('redacts api keys and bearer tokens in ctx', () => {
    log('info', 'auth', {
      api_key: 'sk-or-v1-supersecret',
      headers: { authorization: 'Bearer sk-or-v1-leaked' },
    });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.api_key).toBe('[REDACTED]');
    expect(parsed.ctx.headers.authorization).toBe('[REDACTED]');
  });

  it('redacts data URLs and long base64 blobs', () => {
    const blob = 'A'.repeat(300);
    log('info', 'media', {
      url: `data:image/png;base64,${blob}`,
      payload: blob,
    });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.url).toMatch(/^\[REDACTED data-url/);
    expect(parsed.ctx.payload).toMatch(/^\[REDACTED base64/);
  });

  it('writes only through stderr sink, never stdout', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    _sink.write = origWrite;
    log('info', 'stderr-only');
    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    _sink.write = (line: string) => {
      lines.push(line);
    };
  });
});
