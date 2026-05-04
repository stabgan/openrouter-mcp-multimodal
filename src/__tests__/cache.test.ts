import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildCacheHeaders,
  extractCacheMeta,
  readCacheDefault,
} from '../tool-handlers/cache.js';

describe('buildCacheHeaders', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns empty object when nothing is set', () => {
    expect(buildCacheHeaders(undefined)).toEqual({});
    expect(buildCacheHeaders({})).toEqual({});
  });

  it('sets X-OpenRouter-Cache when cache=true', () => {
    expect(buildCacheHeaders({ cache: true })).toEqual({
      'X-OpenRouter-Cache': 'true',
    });
  });

  it('passes through cache_ttl verbatim', () => {
    expect(buildCacheHeaders({ cache: true, cache_ttl: '15m' })).toEqual({
      'X-OpenRouter-Cache': 'true',
      'X-OpenRouter-Cache-TTL': '15m',
    });
  });

  it('sets the cache-clear header when requested', () => {
    expect(buildCacheHeaders({ cache: true, cache_clear: true })).toEqual({
      'X-OpenRouter-Cache': 'true',
      'X-OpenRouter-Cache-Clear': 'true',
    });
  });

  it('honors the env default when cache is not explicitly set', () => {
    vi.stubEnv('OPENROUTER_CACHE_RESPONSES', '1');
    expect(buildCacheHeaders({})).toEqual({ 'X-OpenRouter-Cache': 'true' });
  });

  it('lets caller override env default to false', () => {
    vi.stubEnv('OPENROUTER_CACHE_RESPONSES', '1');
    expect(buildCacheHeaders({ cache: false })).toEqual({});
  });
});

describe('readCacheDefault', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['1', 'true', 'TRUE', 'yes', 'Yes'])('accepts truthy %s', (v) => {
    vi.stubEnv('OPENROUTER_CACHE_RESPONSES', v);
    expect(readCacheDefault()).toBe(true);
  });

  it.each(['0', 'false', 'no', '', 'nonsense'])('rejects non-truthy %s', (v) => {
    vi.stubEnv('OPENROUTER_CACHE_RESPONSES', v);
    expect(readCacheDefault()).toBe(false);
  });

  it('defaults to false when unset', () => {
    vi.stubEnv('OPENROUTER_CACHE_RESPONSES', '');
    expect(readCacheDefault()).toBe(false);
  });
});

describe('extractCacheMeta', () => {
  it('returns null when no cache header is present', () => {
    expect(extractCacheMeta(new Headers())).toBeNull();
    expect(extractCacheMeta(undefined)).toBeNull();
  });

  it('extracts status, age, ttl from headers', () => {
    const headers = new Headers({
      'x-openrouter-cache-status': 'HIT',
      'x-openrouter-cache-age': '42',
      'x-openrouter-cache-ttl': '300',
    });
    expect(extractCacheMeta(headers)).toEqual({
      status: 'HIT',
      age: 42,
      ttl: '300',
    });
  });

  it('handles MISS with no age', () => {
    const headers = new Headers({ 'x-openrouter-cache-status': 'MISS' });
    expect(extractCacheMeta(headers)).toEqual({ status: 'MISS' });
  });

  it('skips NaN age gracefully', () => {
    const headers = new Headers({
      'x-openrouter-cache-status': 'HIT',
      'x-openrouter-cache-age': 'not-a-number',
    });
    expect(extractCacheMeta(headers)).toEqual({ status: 'HIT' });
  });
});

describe('integration with analyze_image', () => {
  let original: typeof process.env;
  beforeEach(() => {
    original = { ...process.env };
  });
  afterEach(() => {
    process.env = original;
  });

  it('uses env-driven server-wide default without per-call flag', () => {
    vi.stubEnv('OPENROUTER_CACHE_RESPONSES', '1');
    const h = buildCacheHeaders({});
    expect(h['X-OpenRouter-Cache']).toBe('true');
  });
});
