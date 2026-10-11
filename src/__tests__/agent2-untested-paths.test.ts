/**
 * Agent 2 — Test coverage for untested code paths across multiple modules.
 *
 * Targets:
 * 1. cache.ts: numeric cache_ttl coercion, validateCacheOptions with falsy number,
 *    buildCacheHeaders auto-enable when cache_ttl is provided
 * 2. provider-routing.ts: mergeProviderOptions prototype pollution guard,
 *    buildProviderBody filtering of null/empty arrays
 * 3. tool-result-payload.ts: preEncodedBase64 optimization, prefixText option
 * 4. generate-video.ts: Sora model rejection, type validation for resolution/
 *    aspect_ratio/duration/seed/poll_interval_ms/max_wait_ms/reference_images,
 *    handleGetVideoStatus invalid video_id, consecutive poll failure cap
 * 5. generate-image-dedicated.ts: n validation edge cases, input_references
 *    non-array and entry count limit
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  resolveCacheTtl,
  validateCacheOptions,
  buildCacheHeaders,
} from '../tool-handlers/cache.js';
import { mergeProviderOptions, buildProviderBody } from '../tool-handlers/provider-routing.js';
import { buildBinaryToolResult } from '../tool-handlers/tool-result-payload.js';
import {
  handleGenerateVideo,
  handleGetVideoStatus,
  _internals,
} from '../tool-handlers/generate-video.js';
import { handleGenerateImageDedicated } from '../tool-handlers/generate-image-dedicated.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkVideoClient(plan: Partial<OpenRouterAPIClient> = {}): OpenRouterAPIClient {
  return plan as OpenRouterAPIClient;
}

function mkImageClient(plan: Partial<OpenRouterAPIClient> = {}): OpenRouterAPIClient {
  return plan as OpenRouterAPIClient;
}

// ---------------------------------------------------------------------------
// cache.ts — numeric cache_ttl coercion
// ---------------------------------------------------------------------------

describe('resolveCacheTtl — numeric coercion', () => {
  it('accepts a positive integer number as seconds', () => {
    // The code coerces `cache_ttl: 300` (number) to `"300"` (string)
    expect(resolveCacheTtl(300 as unknown as string)).toBe('300');
  });

  it('accepts 1 as the minimum boundary', () => {
    expect(resolveCacheTtl(1 as unknown as string)).toBe('1');
  });

  it('accepts 86400 as the maximum boundary', () => {
    expect(resolveCacheTtl(86400 as unknown as string)).toBe('86400');
  });

  it('rejects NaN number', () => {
    const r = resolveCacheTtl(NaN as unknown as string);
    expect(r).toMatchObject({ isError: true, _meta: { code: 'INVALID_INPUT' } });
  });

  it('rejects Infinity number', () => {
    const r = resolveCacheTtl(Infinity as unknown as string);
    expect(r).toMatchObject({ isError: true, _meta: { code: 'INVALID_INPUT' } });
  });

  it('rejects floating-point number', () => {
    const r = resolveCacheTtl(1.5 as unknown as string);
    expect(r).toMatchObject({ isError: true, _meta: { code: 'INVALID_INPUT' } });
  });

  it('rejects negative number', () => {
    const r = resolveCacheTtl(-10 as unknown as string);
    expect(r).toMatchObject({ isError: true, _meta: { code: 'INVALID_INPUT' } });
  });

  it('rejects non-string non-number type (boolean)', () => {
    const r = resolveCacheTtl(true as unknown as string);
    expect(r).toMatchObject({ isError: true, _meta: { code: 'INVALID_INPUT' } });
  });

  it('rejects non-string non-number type (object)', () => {
    const r = resolveCacheTtl({} as unknown as string);
    expect(r).toMatchObject({ isError: true, _meta: { code: 'INVALID_INPUT' } });
  });
});

describe('validateCacheOptions — falsy number edge case', () => {
  it('returns INVALID_INPUT for cache_ttl: 0 (falsy number)', () => {
    // `cache_ttl: 0` is a falsy number — the original code path skipped
    // validation for falsy values; the fix checks for undefined/null/""
    const r = validateCacheOptions({ cache_ttl: 0 as unknown as string });
    expect(r).toMatchObject({ isError: true, _meta: { code: 'INVALID_INPUT' } });
  });

  it('returns null for cache_ttl: undefined (no validation needed)', () => {
    expect(validateCacheOptions({ cache_ttl: undefined })).toBeNull();
  });

  it('returns null for cache_ttl: null', () => {
    expect(validateCacheOptions({ cache_ttl: null as unknown as string })).toBeNull();
  });

  it('returns null for cache_ttl: "" (empty string)', () => {
    expect(validateCacheOptions({ cache_ttl: '' })).toBeNull();
  });

  it('returns null for valid numeric cache_ttl', () => {
    expect(validateCacheOptions({ cache_ttl: 300 as unknown as string })).toBeNull();
  });
});

describe('buildCacheHeaders — auto-enable when cache_ttl is provided', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('auto-enables caching when cache_ttl is set without explicit cache flag', () => {
    // When cache_ttl is provided, the code should set X-OpenRouter-Cache
    // even without cache: true
    const headers = buildCacheHeaders({ cache_ttl: '300' });
    expect(headers['X-OpenRouter-Cache']).toBe('true');
    expect(headers['X-OpenRouter-Cache-TTL']).toBe('300');
  });

  it('auto-enables caching when cache_ttl is a numeric value', () => {
    const headers = buildCacheHeaders({ cache_ttl: 300 as unknown as string });
    expect(headers['X-OpenRouter-Cache']).toBe('true');
    expect(headers['X-OpenRouter-Cache-TTL']).toBe('300');
  });

  it('respects explicit cache: false even when cache_ttl is set', () => {
    const headers = buildCacheHeaders({ cache: false, cache_ttl: '300' });
    expect(headers['X-OpenRouter-Cache']).toBeUndefined();
    // TTL header is still included since it was explicitly requested
    expect(headers['X-OpenRouter-Cache-TTL']).toBe('300');
  });
});

// ---------------------------------------------------------------------------
// provider-routing.ts — mergeProviderOptions prototype pollution guard
// ---------------------------------------------------------------------------

describe('mergeProviderOptions — prototype pollution guard', () => {
  it('skips __proto__ key from overrides', () => {
    const base = { sort: 'price' as const };
    const overrides = Object.create(null);
    overrides.__proto__ = 'evil';
    overrides.sort = 'latency';
    const merged = mergeProviderOptions(base, overrides);
    expect(merged.sort).toBe('latency');
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(false);
  });

  it('skips constructor key from overrides', () => {
    const base = { sort: 'price' as const };
    const overrides = Object.create(null);
    overrides.constructor = 'evil';
    overrides.sort = 'throughput';
    const merged = mergeProviderOptions(base, overrides);
    expect(merged.sort).toBe('throughput');
    // The guard prevents the "evil" value from overriding the inherited Object constructor.
    // merged['constructor'] is the built-in Object constructor, not the attacker's string.
    expect((merged as Record<string, unknown>)['constructor']).not.toBe('evil');
  });

  it('skips prototype key from overrides', () => {
    const base = { sort: 'price' as const };
    const overrides = Object.create(null);
    overrides.prototype = 'evil';
    const merged = mergeProviderOptions(base, overrides);
    expect((merged as Record<string, unknown>)['prototype']).toBeUndefined();
  });

  it('preserves legitimate keys from overrides', () => {
    const base = { sort: 'price' as const, ignore: ['openai'] };
    const overrides = { sort: 'latency' as const, only: ['anthropic'] };
    const merged = mergeProviderOptions(base, overrides);
    expect(merged.sort).toBe('latency');
    expect(merged.only).toEqual(['anthropic']);
    expect(merged.ignore).toEqual(['openai']);
  });

  it('does not erase base when override value is undefined', () => {
    const base = { sort: 'price' as const, ignore: ['openai'] };
    const overrides = { sort: undefined, ignore: undefined };
    const merged = mergeProviderOptions(base, overrides);
    expect(merged.sort).toBe('price');
    expect(merged.ignore).toEqual(['openai']);
  });
});

describe('buildProviderBody — filtering', () => {
  it('returns undefined when all values are empty/undefined', () => {
    expect(buildProviderBody({ quantizations: [], ignore: [], only: [] })).toBeUndefined();
  });

  it('returns undefined for an empty options object', () => {
    expect(buildProviderBody({})).toBeUndefined();
  });

  it('filters out null values', () => {
    const result = buildProviderBody({
      sort: 'price',
      ignore: null as unknown as string[],
    });
    expect(result).toEqual({ sort: 'price' });
  });

  it('filters out undefined values', () => {
    const result = buildProviderBody({
      sort: 'throughput',
      only: undefined,
    });
    expect(result).toEqual({ sort: 'throughput' });
  });

  it('includes non-empty arrays', () => {
    const result = buildProviderBody({
      quantizations: ['fp16', 'int8'],
      ignore: [],
    });
    expect(result).toEqual({ quantizations: ['fp16', 'int8'] });
  });
});

// ---------------------------------------------------------------------------
// tool-result-payload.ts — preEncodedBase64 and prefixText
// ---------------------------------------------------------------------------

describe('buildBinaryToolResult — preEncodedBase64 optimization', () => {
  it('uses preEncodedBase64 instead of re-encoding the buffer', () => {
    const buf = Buffer.from('raw-image-bytes');
    const b64 = 'cHJlLWVuY29kZWQtYmFzZTY0'; // pre-encoded base64 (different from buf)
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: buf, mimeType: 'image/png' },
      { inlineOnly: true, maxInlineBytes: 10000, preEncodedBase64: b64 },
    );
    expect(r.content[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      data: b64,
    });
  });

  it('falls back to buffer.toString("base64") when preEncodedBase64 is undefined', () => {
    const buf = Buffer.from('hello');
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: buf, mimeType: 'image/png' },
      { inlineOnly: true, maxInlineBytes: 10000 },
    );
    expect(r.content[0]).toMatchObject({
      type: 'image',
      data: buf.toString('base64'),
    });
  });
});

describe('buildBinaryToolResult — prefixText option', () => {
  it('uses prefixText as the text block when inlining media', () => {
    const buf = Buffer.from('audio-bytes');
    const r = buildBinaryToolResult(
      { kind: 'audio', buffer: buf, mimeType: 'audio/wav' },
      { maxInlineBytes: 10000, prefixText: 'Speech generated in 2.3s' },
    );
    expect(r.content).toHaveLength(2);
    expect(r.content[0]).toMatchObject({ type: 'text', text: 'Speech generated in 2.3s' });
    expect(r.content[1]).toMatchObject({ type: 'audio', mimeType: 'audio/wav' });
  });

  it('uses default label when prefixText is not set', () => {
    const buf = Buffer.from('img');
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: buf, mimeType: 'image/jpeg' },
      { maxInlineBytes: 10000 },
    );
    expect(r.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Image generated'),
    });
  });
});

describe('buildBinaryToolResult — summaryText for too-large without remoteUrl', () => {
  it('omits URL hint when remoteUrl is not provided', () => {
    const buf = Buffer.alloc(5000, 1);
    const r = buildBinaryToolResult(
      { kind: 'video', buffer: buf, mimeType: 'video/mp4' },
      { maxInlineBytes: 100 },
    );
    expect(r.content[0]?.text).toContain('Too large to inline');
    expect(r.content[0]?.text).not.toContain('URL:');
  });
});

// ---------------------------------------------------------------------------
// generate-video.ts — Sora model rejection
// ---------------------------------------------------------------------------

describe('handleGenerateVideo — Sora model rejection', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '/tmp');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects openai/sora-2 with alternatives list', async () => {
    const submitVideoJob = vi.fn();
    const client = mkVideoClient({ submitVideoJob });
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'a sunset', model: 'openai/sora-2' } } },
      client,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('removed');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('google/veo-3.1');
    // Should NOT have called the API
    expect(submitVideoJob).not.toHaveBeenCalled();
  });

  it('rejects openai/sora-2-pro variant', async () => {
    const submitVideoJob = vi.fn();
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'a cat', model: 'openai/sora-2-pro' } } },
      mkVideoClient({ submitVideoJob }),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect(submitVideoJob).not.toHaveBeenCalled();
  });

  it('accepts non-Sora models', async () => {
    const submitVideoJob = vi.fn().mockResolvedValue({ id: 'v1', status: 'pending' });
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v1',
      status: 'completed',
      unsigned_urls: ['https://example.com/v.mp4'],
    });
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: Buffer.from('video'),
      contentType: 'video/mp4',
    });
    await handleGenerateVideo(
      {
        params: {
          arguments: {
            prompt: 'a cat',
            model: 'google/veo-3.1',
            poll_interval_ms: 50,
            max_wait_ms: 500,
          },
        },
      },
      mkVideoClient({ submitVideoJob, pollVideoJob, downloadVideoContent }),
    );
    expect(submitVideoJob).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// generate-video.ts — input validation edge cases
// ---------------------------------------------------------------------------

describe('handleGenerateVideo — parameter type validation', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '/tmp');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects non-string model', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', model: 42 as unknown as string } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('model');
  });

  it('rejects non-string resolution', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', resolution: 720 as unknown as string } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('resolution');
  });

  it('rejects non-string aspect_ratio', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', aspect_ratio: 16 as unknown as string } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('aspect_ratio');
  });

  it('rejects floating-point duration', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', duration: 4.5 } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('duration');
  });

  it('rejects zero duration', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', duration: 0 } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('duration');
  });

  it('rejects negative duration', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', duration: -3 } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
  });

  it('rejects NaN duration', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', duration: NaN } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
  });

  it('rejects floating-point seed', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', seed: 1.5 } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('seed');
  });

  it('rejects NaN seed', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', seed: NaN } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
  });

  it('rejects poll_interval_ms below minimum', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', poll_interval_ms: 10 } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain(
      'poll_interval_ms',
    );
  });

  it('rejects non-integer poll_interval_ms', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', poll_interval_ms: 100.5 } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
  });

  it('rejects NaN poll_interval_ms', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', poll_interval_ms: NaN } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
  });

  it('rejects max_wait_ms below 100', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', max_wait_ms: 50 } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('max_wait_ms');
  });

  it('rejects non-integer max_wait_ms', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', max_wait_ms: 1000.5 } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
  });

  it('rejects reference_images non-array', async () => {
    const r = await handleGenerateVideo(
      {
        params: {
          arguments: { prompt: 'test', reference_images: 'not-array' as unknown as string[] },
        },
      },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain(
      'reference_images',
    );
  });

  it('rejects reference_images with empty string entry', async () => {
    const r = await handleGenerateVideo(
      {
        params: {
          arguments: { prompt: 'test', reference_images: ['valid.png', ''] },
        },
      },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain(
      'non-empty string',
    );
  });

  it('rejects reference_images exceeding 50 entries', async () => {
    const refs = Array.from({ length: 51 }, (_, i) => `https://example.com/img${i}.png`);
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'test', reference_images: refs } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('51');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('50');
  });
});

// ---------------------------------------------------------------------------
// handleGetVideoStatus — video_id validation
// ---------------------------------------------------------------------------

describe('handleGetVideoStatus — video_id validation', () => {
  it('rejects missing video_id', async () => {
    const r = await handleGetVideoStatus(
      { params: { arguments: { video_id: '' } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects video_id with path traversal', async () => {
    const r = await handleGetVideoStatus(
      { params: { arguments: { video_id: '../etc/passwd' } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects video_id exceeding max length', async () => {
    const r = await handleGetVideoStatus(
      { params: { arguments: { video_id: 'a'.repeat(257) } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects video_id with control characters', async () => {
    const r = await handleGetVideoStatus(
      { params: { arguments: { video_id: 'vid\n123' } } },
      mkVideoClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// generate-video.ts — _internals.MAX_CONSECUTIVE_POLL_FAILURES
// ---------------------------------------------------------------------------

describe('generate-video — MAX_CONSECUTIVE_POLL_FAILURES constant', () => {
  it('is set to 5 as documented', () => {
    expect(_internals.MAX_CONSECUTIVE_POLL_FAILURES).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// generate-image-dedicated.ts — n and input_references validation
// ---------------------------------------------------------------------------

describe('handleGenerateImageDedicated — n validation edge cases', () => {
  it('rejects n = 0', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', n: 0 } } },
      mkImageClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('n');
  });

  it('rejects n = 11 (over MAX_IMAGES)', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', n: 11 } } },
      mkImageClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('n');
  });

  it('rejects negative n', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', n: -1 } } },
      mkImageClient({}),
    );
    expect(r.isError).toBe(true);
  });

  it('rejects non-integer n', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', n: 1.5 } } },
      mkImageClient({}),
    );
    expect(r.isError).toBe(true);
  });

  it('rejects NaN n', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', n: NaN } } },
      mkImageClient({}),
    );
    expect(r.isError).toBe(true);
  });

  it('rejects non-number n', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', n: 'two' as unknown as number } } },
      mkImageClient({}),
    );
    expect(r.isError).toBe(true);
  });
});

describe('handleGenerateImageDedicated — input_references validation', () => {
  it('rejects non-array input_references', async () => {
    const r = await handleGenerateImageDedicated(
      {
        params: {
          arguments: { prompt: 'cat', input_references: 'not-array' as unknown as string[] },
        },
      },
      mkImageClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain(
      'input_references',
    );
  });

  it('rejects input_references with empty string entry', async () => {
    const r = await handleGenerateImageDedicated(
      {
        params: {
          arguments: { prompt: 'cat', input_references: ['valid.png', ''] },
        },
      },
      mkImageClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('non-empty');
  });

  it('rejects input_references exceeding 20 entries', async () => {
    const refs = Array.from({ length: 21 }, (_, i) => `https://example.com/img${i}.png`);
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', input_references: refs } } },
      mkImageClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('21');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('20');
  });

  it('rejects input_references with non-string entry', async () => {
    const r = await handleGenerateImageDedicated(
      {
        params: {
          arguments: { prompt: 'cat', input_references: [42 as unknown as string] },
        },
      },
      mkImageClient({}),
    );
    expect(r.isError).toBe(true);
  });
});
