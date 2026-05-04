import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, _sink } from '../logger.js';

describe('logger.audit', () => {
  let writes: string[];
  let originalWrite: typeof _sink.write;

  beforeEach(() => {
    writes = [];
    originalWrite = _sink.write;
    _sink.write = (line: string) => {
      writes.push(line);
    };
  });

  afterEach(() => {
    _sink.write = originalWrite;
    vi.unstubAllEnvs();
  });

  it('emits a JSON line at level=audit', () => {
    logger.audit('generate_video.start', { model: 'google/veo-3.1' });
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!);
    expect(parsed.level).toBe('audit');
    expect(parsed.msg).toBe('generate_video.start');
    expect(parsed.ctx).toEqual({ model: 'google/veo-3.1' });
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('ALWAYS writes, bypassing OPENROUTER_LOG_LEVEL=error', () => {
    vi.stubEnv('OPENROUTER_LOG_LEVEL', 'error');
    logger.info('info-msg');
    logger.audit('audit-msg');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!).msg).toBe('audit-msg');
  });

  it('handles missing ctx', () => {
    logger.audit('simple');
    const parsed = JSON.parse(writes[0]!);
    expect(parsed.ctx).toBeUndefined();
  });

  it('gracefully handles unserializable ctx', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.audit('circular-case', circular);
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!);
    expect(parsed.level).toBe('audit');
    expect(parsed.msg).toBe('circular-case');
    expect(parsed.ctx).toEqual({ note: 'unserializable' });
  });
});
