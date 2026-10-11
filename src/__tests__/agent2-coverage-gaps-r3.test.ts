/**
 * Agent 2 — coverage gaps round 3.
 *
 * Targets code paths in rerank and search_models that are not exercised by
 * any existing test file:
 *
 * Rerank:
 *  1. MAX_TOTAL_INPUT_CHARS (10_000_000) aggregate character limit exceeded
 *  2. MAX_TOTAL_INPUT_CHARS boundary — exactly at the limit (passes)
 *  3. MAX_TOTAL_INPUT_CHARS — just over the limit (one extra char)
 *  4. API response with results=undefined → falls back to empty array
 *  5. API response with results=null → falls back to empty array
 *  6. Valid score field preferred over valid relevance_score (both present)
 *  7. Negative score from API (still finite, should be passed through)
 *  8. Score is 0 from API (falsy but valid, should be passed through)
 *  9. response.usage absent → _meta has no usage key
 * 10. return_documents with API returning string document directly
 *
 * SearchModels:
 * 11. INTERNAL error when searchPaginated throws unexpectedly
 * 12. Upstream error from ensureFresh propagated correctly
 *
 * EmbedText edge:
 * 13. response.data is not an array-like object (boolean)
 *
 * Decide edge:
 * 14. Score answer with large array — loop-based max avoids stack overflow
 * 15. Choice answer with empty choice object in response
 */
import { describe, it, expect, vi } from 'vitest';
import { handleRerankDocuments } from '../tool-handlers/rerank.js';
import { handleSearchModels } from '../tool-handlers/search-models.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

function mockRerankClient(response: unknown, throws?: Error) {
  const rerank = vi.fn();
  if (throws) rerank.mockRejectedValue(throws);
  else rerank.mockResolvedValue(response);
  return { rerank } as unknown as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown) {
  const createEmbeddings = vi.fn().mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  const submitDecision = vi.fn().mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function rerankReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleRerankDocuments>[0];
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

// ---------------------------------------------------------------------------
// 1–3. Rerank — MAX_TOTAL_INPUT_CHARS (10_000_000) aggregate limit
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — MAX_TOTAL_INPUT_CHARS aggregate limit', () => {
  it('returns INVALID_INPUT when aggregate chars exceed 10_000_000', async () => {
    // 102 docs × 99_999 chars each = 10_199_898 chars (+ short query) > 10_000_000
    const docs = Array.from({ length: 102 }, () => 'x'.repeat(99_999));
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test query', documents: docs }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('Total input size');
    expect(r.content[0].text).toContain('10000000');
  });

  it('returns INVALID_INPUT when exactly one char over the aggregate limit', async () => {
    // 100 docs × 99_990 chars = 9_999_000 + query of 1001 chars = 10_000_001 > 10_000_000
    const queryLen = 1001;
    const docLen = 99_990;
    const docs = Array.from({ length: 100 }, () => 'y'.repeat(docLen));
    const query = 'z'.repeat(queryLen);
    const totalChars = queryLen + 100 * docLen;
    expect(totalChars).toBe(10_000_001); // sanity check
    const r = (await handleRerankDocuments(
      rerankReq({ query, documents: docs }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('Total input size');
  });

  it('accepts input at exactly 10_000_000 total chars', async () => {
    // 100 docs × 99_990 chars = 9_999_000 + query of 1000 chars = 10_000_000
    const queryLen = 1000;
    const docLen = 99_990;
    const docs = Array.from({ length: 100 }, () => 'a'.repeat(docLen));
    const query = 'b'.repeat(queryLen);
    const totalChars = queryLen + 100 * docLen;
    expect(totalChars).toBe(10_000_000); // sanity check

    const client = mockRerankClient({
      results: docs.map((_, i) => ({ index: i, score: 0.5 })),
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query, documents: docs }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect(client.rerank).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4–5. Rerank — response.results undefined/null → fallback to empty []
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — results fallback when undefined or null', () => {
  it('returns empty results when API response.results is undefined', async () => {
    const client = mockRerankClient({ model: 'cohere/rerank-v3.5' });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc1'] }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect((r.structuredContent as { results: unknown[] }).results).toEqual([]);
  });

  it('returns empty results when API response.results is null', async () => {
    const client = mockRerankClient({ model: 'cohere/rerank-v3.5', results: null });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc1'] }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect((r.structuredContent as { results: unknown[] }).results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Rerank — valid score preferred when both score and relevance_score present
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — score field priority', () => {
  it('uses valid score over valid relevance_score when both present', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.95, relevance_score: 0.5 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as SuccessResult;
    const results = (r.structuredContent as { results: Array<{ score: number }> }).results;
    expect(results[0].score).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// 7. Rerank — negative score from API (finite, valid)
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — negative score', () => {
  it('passes through negative scores unchanged', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: -0.3 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as SuccessResult;
    const results = (r.structuredContent as { results: Array<{ score: number }> }).results;
    expect(results[0].score).toBe(-0.3);
  });
});

// ---------------------------------------------------------------------------
// 8. Rerank — score of 0 (falsy but valid)
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — zero score', () => {
  it('passes through zero score without falling back to relevance_score', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0, relevance_score: 0.8 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as SuccessResult;
    const results = (r.structuredContent as { results: Array<{ score: number }> }).results;
    // score=0 is finite and typeof 'number', so it should be used (not fall to relevance_score)
    expect(results[0].score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Rerank — response.usage absent → _meta has no usage key
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — _meta.usage presence', () => {
  it('omits usage from _meta when response.usage is absent', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.5 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as SuccessResult;
    expect(r._meta.usage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 10. Rerank — return_documents with string document from API
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — document field variations', () => {
  it('uses string document from API when return_documents=true', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.9, document: 'API returned string' }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['original'], return_documents: true }),
      client,
    )) as SuccessResult;
    const results = (r.structuredContent as { results: Array<{ document: string }> }).results;
    expect(results[0].document).toBe('API returned string');
  });

  it('falls back to original document when API result has no document field', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.7 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['original doc'], return_documents: true }),
      client,
    )) as SuccessResult;
    const results = (r.structuredContent as { results: Array<{ document: string }> }).results;
    expect(results[0].document).toBe('original doc');
  });
});

// ---------------------------------------------------------------------------
// 11. SearchModels — INTERNAL error when searchPaginated throws
// ---------------------------------------------------------------------------

describe('handleSearchModels — INTERNAL error from searchPaginated', () => {
  it('returns INTERNAL when modelCache.searchPaginated throws', async () => {
    const cache = new ModelCache();
    // Seed the cache so isValid() passes, then make searchPaginated throw
    cache.setModels([
      {
        id: 'test/model',
        name: 'Test',
        context_length: 128000,
        pricing: { prompt: '0', completion: '0' },
      },
    ] as Parameters<typeof cache.setModels>[0]);

    const searchPaginatedSpy = vi.spyOn(cache, 'searchPaginated').mockImplementation(() => {
      throw new Error('Unexpected internal failure');
    });

    const api = {
      getModels: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as OpenRouterAPIClient;

    const r = (await handleSearchModels({ params: { arguments: {} } }, api, cache)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('search_models');

    searchPaginatedSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 12. SearchModels — upstream error from ensureFresh
// ---------------------------------------------------------------------------

describe('handleSearchModels — upstream error from ensureFresh', () => {
  it('classifies auth error from ensureFresh', async () => {
    const cache = new ModelCache();
    const err = new Error('invalid api key') as Error & { status: number };
    err.status = 401;
    const api = {
      getModels: vi.fn().mockRejectedValue(err),
    } as unknown as OpenRouterAPIClient;

    const r = (await handleSearchModels({ params: { arguments: {} } }, api, cache)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });
});

// ---------------------------------------------------------------------------
// 13. EmbedText — response.data is non-array (boolean)
// ---------------------------------------------------------------------------

describe('handleEmbedText — non-array data fallback', () => {
  it('returns INTERNAL when response.data is a boolean', async () => {
    const client = mockEmbedClient({ data: true });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  it('returns INTERNAL when response.data is an object (not array)', async () => {
    const client = mockEmbedClient({ data: { foo: 'bar' } });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });
});

// ---------------------------------------------------------------------------
// 14. Decide — score answer with large array (loop-based max)
// ---------------------------------------------------------------------------

describe('handleDecide — large score array in response', () => {
  it('handles large score array without stack overflow', async () => {
    // Create a 1000-element score array — Math.max(...arr) would risk stack overflow
    const scoreArray = new Array(1000).fill(0.001);
    scoreArray[500] = 0.95; // peak at index 500
    const client = mockDecideClient({
      answers: { quality: { type: 'score', score: scoreArray } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          quality: {
            type: 'score',
            instructions: 'rate quality',
            criteria: ['bad', 'good'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('level 501/1000');
    expect(r.content[0].text).toContain('95.0%');
  });
});

// ---------------------------------------------------------------------------
// 15. Decide — choice with empty choice object in response
// ---------------------------------------------------------------------------

describe('handleDecide — choice with empty choice object', () => {
  it('handles empty choice object in response gracefully', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: {} } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick',
            criteria: { a: 'opt a', b: 'opt b' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    // With empty choice object, entries sort returns [] and best is undefined
    // The line should still contain the question name with '?' for best option
    expect(r.content[0].text).toContain('q1');
  });
});

// ---------------------------------------------------------------------------
// Bonus: Rerank — query length contribution to aggregate limit
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — query contributes to aggregate total', () => {
  it('counts query length in aggregate total chars', async () => {
    // Query of 99_999 chars (under per-query 100K limit) + 100 docs × 99_001 chars each
    // = 99_999 + 9_900_100 = 10_000_099 > 10_000_000 aggregate limit
    const longQuery = 'q'.repeat(99_999);
    const docs = Array.from({ length: 100 }, () => 'd'.repeat(99_001));
    const totalChars = longQuery.length + docs.reduce((s, d) => s + d.length, 0);
    expect(totalChars).toBeGreaterThan(10_000_000); // sanity check
    const r = (await handleRerankDocuments(
      rerankReq({ query: longQuery, documents: docs }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('Total input size');
  });
});
