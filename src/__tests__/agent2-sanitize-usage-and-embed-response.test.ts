/**
 * Agent 2 — Coverage for:
 *
 * A. sanitizeUpstreamUsage (src/tool-handlers/sanitize-usage.ts)
 *    ZERO prior dedicated tests. All branches covered:
 *     1. null input → undefined
 *     2. undefined input → undefined
 *     3. Array input → undefined
 *     4. String input → undefined
 *     5. Number input → undefined
 *     6. Boolean input → undefined
 *     7. Object with __proto__ key → undefined (prototype pollution guard)
 *     8. Object with constructor key → undefined
 *     9. Object with prototype key → undefined
 *    10. Empty object → undefined
 *    11. Object with only unknown keys → undefined
 *    12. Object with all four known numeric keys → returns them
 *    13. Object with NaN for known key → drops it
 *    14. Object with Infinity for known key → drops it
 *    15. Object with -Infinity for known key → drops it
 *    16. Object with string for known key → drops it
 *    17. Object with null for known key → drops it
 *    18. Object with object for known key → drops it
 *    19. Object with mixed valid/invalid known keys → only valid survive
 *    20. Object with valid keys + unknown keys → only known keys survive
 *    21. Object with zero cost → cost: 0 is valid finite number
 *
 * B. handleEmbedText — response sanitization (safeIndex / safeEmbedding / safeResponseModel)
 *    ZERO prior tests for these specific code paths:
 *    22. Upstream index is NaN → falls back to positional index
 *    23. Upstream index is negative → falls back to positional index
 *    24. Upstream index is a string → falls back to positional index
 *    25. Upstream index is a float (1.5) → falls back to positional index
 *    26. Upstream embedding is not an array → rawEmbedding becomes []
 *    27. Upstream embedding contains NaN → mapped to 0
 *    28. Upstream embedding contains Infinity → mapped to 0
 *    29. Upstream embedding contains strings → mapped to 0
 *    30. Upstream embedding contains null → mapped to 0
 *    31. Upstream embedding contains mixed valid/invalid → valid kept, invalid → 0
 *    32. Upstream response.model exceeds 256 chars → falls back to effectiveModel
 *    33. Upstream response.model is a number → falls back to effectiveModel
 *    34. Upstream response.model is a boolean → falls back to effectiveModel
 *    35. Upstream response.model is an object → falls back to effectiveModel
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 */
import { describe, it, expect, vi } from 'vitest';
import { sanitizeUpstreamUsage } from '../tool-handlers/sanitize-usage.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ═══════════════════════════════════════════════════════════════════════════
// A. sanitizeUpstreamUsage — comprehensive unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeUpstreamUsage', () => {
  // ── Falsy / non-object inputs → undefined ────────────────────────────

  it('returns undefined for null', () => {
    expect(sanitizeUpstreamUsage(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(sanitizeUpstreamUsage(undefined)).toBeUndefined();
  });

  it('returns undefined for an array', () => {
    expect(sanitizeUpstreamUsage([1, 2, 3] as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it('returns undefined for a string', () => {
    expect(sanitizeUpstreamUsage('usage' as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it('returns undefined for a number', () => {
    expect(sanitizeUpstreamUsage(42 as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it('returns undefined for a boolean', () => {
    expect(sanitizeUpstreamUsage(true as unknown as Record<string, unknown>)).toBeUndefined();
  });

  // ── Prototype-pollution keys → undefined ─────────────────────────────

  it('returns undefined when usage has __proto__ key', () => {
    const usage = Object.create(null);
    usage['__proto__'] = 'attack';
    usage['prompt_tokens'] = 10;
    expect(sanitizeUpstreamUsage(usage)).toBeUndefined();
  });

  it('returns undefined when usage has constructor key', () => {
    const usage = Object.create(null);
    usage['constructor'] = 'attack';
    usage['prompt_tokens'] = 10;
    expect(sanitizeUpstreamUsage(usage)).toBeUndefined();
  });

  it('returns undefined when usage has prototype key', () => {
    const usage = Object.create(null);
    usage['prototype'] = 'attack';
    usage['total_tokens'] = 50;
    expect(sanitizeUpstreamUsage(usage)).toBeUndefined();
  });

  // ── Empty / unknown-keys-only → undefined ────────────────────────────

  it('returns undefined for empty object', () => {
    expect(sanitizeUpstreamUsage({})).toBeUndefined();
  });

  it('returns undefined when all keys are unknown', () => {
    expect(sanitizeUpstreamUsage({ foo: 1, bar: 'hello', baz: true })).toBeUndefined();
  });

  // ── Valid known keys → returns sanitized object ──────────────────────

  it('returns all four known numeric keys when present and valid', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      cost: 0.005,
    };
    expect(sanitizeUpstreamUsage(usage)).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      cost: 0.005,
    });
  });

  it('returns subset of known keys when only some are present', () => {
    expect(sanitizeUpstreamUsage({ prompt_tokens: 5 })).toEqual({ prompt_tokens: 5 });
  });

  it('treats cost: 0 as valid (zero is a finite number)', () => {
    expect(sanitizeUpstreamUsage({ cost: 0 })).toEqual({ cost: 0 });
  });

  it('treats prompt_tokens: 0 as valid', () => {
    expect(sanitizeUpstreamUsage({ prompt_tokens: 0 })).toEqual({ prompt_tokens: 0 });
  });

  // ── Non-finite / non-numeric values for known keys → dropped ─────────

  it('drops NaN from known keys', () => {
    expect(sanitizeUpstreamUsage({ prompt_tokens: NaN, total_tokens: 10 })).toEqual({
      total_tokens: 10,
    });
  });

  it('drops Infinity from known keys', () => {
    expect(sanitizeUpstreamUsage({ prompt_tokens: Infinity })).toBeUndefined();
  });

  it('drops -Infinity from known keys', () => {
    expect(sanitizeUpstreamUsage({ cost: -Infinity })).toBeUndefined();
  });

  it('drops string values for known keys', () => {
    expect(sanitizeUpstreamUsage({ prompt_tokens: 'ten' as unknown as number })).toBeUndefined();
  });

  it('drops null values for known keys', () => {
    expect(sanitizeUpstreamUsage({ prompt_tokens: null as unknown as number })).toBeUndefined();
  });

  it('drops object values for known keys', () => {
    expect(
      sanitizeUpstreamUsage({ prompt_tokens: { nested: true } as unknown as number }),
    ).toBeUndefined();
  });

  it('drops boolean values for known keys', () => {
    expect(sanitizeUpstreamUsage({ cost: true as unknown as number })).toBeUndefined();
  });

  // ── Mixed valid/invalid → only valid survive ─────────────────────────

  it('keeps valid keys and drops invalid ones in mixed usage object', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: NaN,
      total_tokens: 'fifty' as unknown as number,
      cost: 0.01,
      extra_unknown_key: 42,
    };
    expect(sanitizeUpstreamUsage(usage)).toEqual({
      prompt_tokens: 10,
      cost: 0.01,
    });
  });

  it('drops unknown keys even when they have valid numeric values', () => {
    const usage = {
      prompt_tokens: 5,
      unknown_field: 100,
      another_field: 200,
    };
    expect(sanitizeUpstreamUsage(usage)).toEqual({
      prompt_tokens: 5,
    });
  });

  it('returns undefined when all known keys have non-finite values', () => {
    expect(
      sanitizeUpstreamUsage({
        prompt_tokens: NaN,
        completion_tokens: Infinity,
        total_tokens: -Infinity,
        cost: NaN,
      }),
    ).toBeUndefined();
  });

  // ── Negative numeric values → still finite, still included ───────────

  it('includes negative values (they are finite numbers)', () => {
    // Negative token counts are unusual but sanitizeUpstreamUsage only checks
    // finitude, not sign — semantic validation belongs elsewhere.
    expect(sanitizeUpstreamUsage({ cost: -0.001 })).toEqual({ cost: -0.001 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Helpers for handleEmbedText tests
// ═══════════════════════════════════════════════════════════════════════════

type EmbedSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
};

function mockEmbedClient(response: unknown) {
  const createEmbeddings = vi.fn().mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// B. handleEmbedText — response index sanitization (safeIndex)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — safeIndex fallback in response sanitization', () => {
  it('falls back to positional index when upstream index is NaN', async () => {
    const client = mockEmbedClient({
      data: [
        { index: NaN, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    // NaN fails Number.isInteger check → falls back to positional index 0
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    expect(r.structuredContent.embeddings[1].index).toBe(1);
  });

  it('falls back to positional index when upstream index is negative', async () => {
    const client = mockEmbedClient({
      data: [{ index: -1, embedding: [0.5] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    // -1 fails e.index >= 0 check → falls back to positional index 0
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });

  it('falls back to positional index when upstream index is a string', async () => {
    const client = mockEmbedClient({
      data: [{ index: 'zero', embedding: [0.3] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    // typeof 'string' !== 'number' → falls back to 0
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });

  it('falls back to positional index when upstream index is a float', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0.5, embedding: [0.1] },
        { index: 1.7, embedding: [0.2] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    // 0.5 fails Number.isInteger check → falls back to positional indices
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    expect(r.structuredContent.embeddings[1].index).toBe(1);
  });

  it('falls back to positional index when upstream index is undefined', async () => {
    const client = mockEmbedClient({
      data: [{ embedding: [0.4] }], // no index field at all
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });

  it('falls back to positional index when upstream index is Infinity', async () => {
    const client = mockEmbedClient({
      data: [{ index: Infinity, embedding: [0.1] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    // Infinity fails Number.isInteger check → falls back to 0
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. handleEmbedText — response embedding value sanitization (safeEmbedding)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — safeEmbedding value sanitization in response', () => {
  it('replaces NaN in embedding values with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, NaN, 0.3] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0, 0.3]);
  });

  it('replaces Infinity in embedding values with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [Infinity, -Infinity, 0.5] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0, 0.5]);
  });

  it('replaces string values in embedding with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 'bad', 0.3] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0, 0.3]);
  });

  it('replaces null values in embedding with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [null, 0.2, null] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0.2, 0]);
  });

  it('replaces boolean values in embedding with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [true, false, 0.5] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0, 0.5]);
  });

  it('replaces object values in embedding with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [{ nested: true }, 0.7] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0.7]);
  });

  it('sanitizes mixed valid and invalid values in batch embeddings', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, NaN, 'bad'] },
        { index: 1, embedding: [Infinity, 0.5, null] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0, 0]);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([0, 0.5, 0]);
  });

  it('uses empty array when upstream embedding is not an array (number)', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] }, // first must be valid for shape check
        { index: 1, embedding: 42 }, // second has non-array embedding
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    // Second embedding has non-array → rawEmbedding = [] → safeEmbedding = []
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });

  it('uses empty array when upstream embedding is a string', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.5] }, // first valid
        { index: 1, embedding: 'not an array' },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. handleEmbedText — response model sanitization (safeResponseModel)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — safeResponseModel fallback in response sanitization', () => {
  it('falls back to effectiveModel when response.model exceeds 256 chars', async () => {
    const longModel = 'x'.repeat(257);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: longModel,
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello'], model: 'voyage/voyage-3' }),
      client,
    )) as EmbedSuccessResult;
    // response model too long → safeResponseModel is undefined → displayModel = effectiveModel
    expect(r.structuredContent.model).toBe('voyage/voyage-3');
    expect(r._meta.model).toBe('voyage/voyage-3');
    expect(r.content[0].text).toContain('voyage/voyage-3');
  });

  it('falls back to effectiveModel when response.model is a number', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 12345,
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    // typeof 12345 !== 'string' → safeResponseModel is undefined → displayModel = effectiveModel
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
    expect(r._meta.model).toBe('openai/text-embedding-3-small');
  });

  it('falls back to effectiveModel when response.model is a boolean', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: true,
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
  });

  it('falls back to effectiveModel when response.model is an object', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.2] }],
      model: { name: 'model' },
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello'], model: 'cohere/embed-v4' }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.model).toBe('cohere/embed-v4');
    expect(r._meta.model).toBe('cohere/embed-v4');
  });

  it('uses response.model when it is a valid string under 256 chars', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-large',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-large');
  });

  it('uses response.model at exactly 256 chars (boundary)', async () => {
    const exactModel = 'a'.repeat(256);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: exactModel,
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    // 256 chars exactly → safeResponseModel = exactModel → used as displayModel
    expect(r.structuredContent.model).toBe(exactModel);
  });
});
