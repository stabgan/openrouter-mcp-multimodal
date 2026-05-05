import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  resolveMaxTokens,
  readDefaultMaxTokens,
} from '../tool-handlers/provider-routing.js';

describe('readProviderDefaults', () => {
  beforeEach(() => {
    // Start every test with no OPENROUTER_PROVIDER_* vars set.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('OPENROUTER_PROVIDER_') || key === 'OPENROUTER_MAX_TOKENS') {
        vi.stubEnv(key, '');
      }
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns empty object when no env vars are set', () => {
    expect(readProviderDefaults()).toEqual({});
  });

  it('parses comma-separated quantizations and ignore lists', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_QUANTIZATIONS', 'fp16, int8,int4');
    vi.stubEnv('OPENROUTER_PROVIDER_IGNORE', 'openai,anthropic, mistralai');
    const d = readProviderDefaults();
    expect(d.quantizations).toEqual(['fp16', 'int8', 'int4']);
    expect(d.ignore).toEqual(['openai', 'anthropic', 'mistralai']);
  });

  it('normalizes sort, data_collection enums; drops invalid values', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_SORT', 'PRICE');
    vi.stubEnv('OPENROUTER_PROVIDER_DATA_COLLECTION', 'Deny');
    const d = readProviderDefaults();
    expect(d.sort).toBe('price');
    expect(d.data_collection).toBe('deny');
  });

  it('drops invalid sort values silently', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_SORT', 'fastest');
    const d = readProviderDefaults();
    expect(d.sort).toBeUndefined();
  });

  it('parses booleans (true/false, 1/0, yes/no)', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_REQUIRE_PARAMETERS', 'true');
    vi.stubEnv('OPENROUTER_PROVIDER_ALLOW_FALLBACKS', '0');
    const d = readProviderDefaults();
    expect(d.require_parameters).toBe(true);
    expect(d.allow_fallbacks).toBe(false);
  });

  it('parses order as JSON array of strings', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_ORDER', '["openai/gpt-4o","anthropic/claude-3-opus"]');
    expect(readProviderDefaults().order).toEqual([
      'openai/gpt-4o',
      'anthropic/claude-3-opus',
    ]);
  });

  it('parses order as a comma-separated fallback', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_ORDER', 'openai/gpt-4o,anthropic/claude-3-opus');
    expect(readProviderDefaults().order).toEqual([
      'openai/gpt-4o',
      'anthropic/claude-3-opus',
    ]);
  });

  it('drops malformed order without throwing', async () => {
    // Expected: we log a structured warning via logger.warn and drop the value.
    const { _sink } = await import('../logger.js');
    const lines: string[] = [];
    const origWrite = _sink.write;
    _sink.write = (line: string) => { lines.push(line); };
    vi.stubEnv('OPENROUTER_PROVIDER_ORDER', '[bogus json]');
    expect(readProviderDefaults().order).toBeUndefined();
    _sink.write = origWrite;
    expect(lines.some((l) => l.includes('OPENROUTER_PROVIDER_ORDER ignored'))).toBe(true);
  });
});

describe('mergeProviderOptions', () => {
  it('applies overrides on top of defaults', () => {
    const merged = mergeProviderOptions(
      { sort: 'price', ignore: ['openai'] },
      { sort: 'latency' },
    );
    expect(merged).toEqual({ sort: 'latency', ignore: ['openai'] });
  });

  it('returns a copy when overrides is undefined', () => {
    const defaults = { sort: 'price' as const };
    const merged = mergeProviderOptions(defaults);
    expect(merged).toEqual(defaults);
    expect(merged).not.toBe(defaults);
  });

  it('skips undefined override fields (does not erase defaults)', () => {
    const merged = mergeProviderOptions(
      { sort: 'price' },
      { sort: undefined, allow_fallbacks: false },
    );
    expect(merged.sort).toBe('price');
    expect(merged.allow_fallbacks).toBe(false);
  });
});

describe('buildProviderBody', () => {
  it('returns undefined when nothing is set', () => {
    expect(buildProviderBody({})).toBeUndefined();
  });

  it('drops empty arrays and undefined values', () => {
    const body = buildProviderBody({
      quantizations: [],
      ignore: ['openai'],
      sort: 'price',
      order: undefined,
    });
    expect(body).toEqual({ ignore: ['openai'], sort: 'price' });
  });

  it('includes false booleans', () => {
    const body = buildProviderBody({ allow_fallbacks: false });
    expect(body).toEqual({ allow_fallbacks: false });
  });
});

describe('max_tokens handling', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('readDefaultMaxTokens returns undefined when unset', () => {
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '');
    expect(readDefaultMaxTokens()).toBeUndefined();
  });

  it('readDefaultMaxTokens parses positive integers', () => {
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '4096');
    expect(readDefaultMaxTokens()).toBe(4096);
  });

  it('readDefaultMaxTokens drops zero / negative / non-numeric', () => {
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '0');
    expect(readDefaultMaxTokens()).toBeUndefined();
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '-1');
    expect(readDefaultMaxTokens()).toBeUndefined();
    vi.stubEnv('OPENROUTER_MAX_TOKENS', 'abc');
    expect(readDefaultMaxTokens()).toBeUndefined();
  });

  it('resolveMaxTokens prefers the request value over the env default', () => {
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '4096');
    expect(resolveMaxTokens(512)).toBe(512);
    expect(resolveMaxTokens()).toBe(4096);
    expect(resolveMaxTokens(0)).toBe(4096); // 0 is treated as "unset" for request
  });
});
