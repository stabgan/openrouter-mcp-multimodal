import { describe, it, expect } from 'vitest';
import { buildStructuredResult, readToolPayload } from '../../tool-handlers/structured-output.js';
import {
  mergeProviderOptions,
  readProviderDefaults,
} from '../../tool-handlers/provider-routing.js';
import { buildCacheHeaders } from '../../tool-handlers/cache.js';
import { SERVER_VERSION, MCP_PROTOCOL_VERSION } from '../../version.js';
import {
  FREE_CHAT_MODELS,
  FREE_VISION_MODELS,
  FREE_INTEGRATION_MODEL,
} from '../helpers/free-models.js';

describe('mock strata: structured output matrix', () => {
  const payloads = [
    { ok: true },
    { results: [], total: 0 },
    { valid: false, model: 'x' },
    { nested: { a: 1, b: [1, 2, 3] } },
    { text: 'hello', count: 42 },
  ];
  it.each(payloads)('buildStructuredResult round-trips payload %#', (payload) => {
    const r = buildStructuredResult(payload);
    expect(r.structuredContent).toEqual(payload);
    expect(readToolPayload(r)).toEqual(payload);
  });

  const metaCases = [{ usage: { total_tokens: 1 } }, { video_id: 'vid_1' }, {}];
  it.each(metaCases)('buildStructuredResult merges meta %#', (meta) => {
    const r = buildStructuredResult({ x: 1 }, meta);
    expect(r._meta).toMatchObject(meta);
    expect(r.structuredContent).toEqual({ x: 1 });
  });
});

describe('mock strata: provider routing matrix', () => {
  it.each(['price', 'throughput', 'latency'] as const)('accepts sort=%s in merge', (sort) => {
    const merged = mergeProviderOptions({ sort }, {});
    expect(merged.sort).toBe(sort);
  });

  it.each([true, false])('allow_fallbacks=%s merges', (v) => {
    const merged = mergeProviderOptions({ allow_fallbacks: v }, {});
    expect(merged.allow_fallbacks).toBe(v);
  });

  it.each(['allow', 'deny'] as const)('data_collection=%s merges', (v) => {
    const merged = mergeProviderOptions({ data_collection: v }, {});
    expect(merged.data_collection).toBe(v);
  });

  const envPairs: Array<[string, string]> = [
    ['OPENROUTER_PROVIDER_SORT', 'price'],
    ['OPENROUTER_PROVIDER_DATA_COLLECTION', 'deny'],
    ['OPENROUTER_PROVIDER_ALLOW_FALLBACKS', 'true'],
  ];
  it.each(envPairs)('readProviderDefaults reads %s', (key, value) => {
    const prev = process.env[key];
    process.env[key] = value;
    try {
      const d = readProviderDefaults();
      expect(d).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  });
});

describe('mock strata: cache header matrix', () => {
  it.each([
    [{ cache: true }],
    [{ cache: false }],
    [{ cache_ttl: '1h' }],
    [{ cache_clear: true }],
    [{ cache: true, cache_ttl: '30m' }],
  ] as const)('buildCacheHeaders handles options %#', (opts) => {
    const headers = buildCacheHeaders(opts);
    expect(typeof headers).toBe('object');
  });
});

describe('mock strata: version and free model constants', () => {
  it('SERVER_VERSION is semver-like', () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('MCP_PROTOCOL_VERSION is dated spec', () => {
    expect(MCP_PROTOCOL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(FREE_CHAT_MODELS)('FREE_CHAT_MODELS includes %s', (m) => {
    expect(m.length).toBeGreaterThan(3);
  });

  it.each(FREE_VISION_MODELS)('FREE_VISION_MODELS includes %s', (m) => {
    expect(m).toContain(':free');
  });

  it('FREE_INTEGRATION_MODEL is a free slug', () => {
    expect(FREE_INTEGRATION_MODEL).toContain(':free');
  });
});

describe('mock strata: readToolPayload fallbacks', () => {
  it.each([
    [{ structuredContent: { a: 1 } }, { a: 1 }],
    [{ content: [{ type: 'text', text: '{"b":2}' }] }, { b: 2 }],
  ] as const)('readToolPayload extracts %#', (result, expected) => {
    expect(readToolPayload(result)).toEqual(expected);
  });
});
