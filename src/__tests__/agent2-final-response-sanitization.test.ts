/**
 * Agent 2 — Final response sanitization coverage for rerank, embed_text, and decide.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Confirmed untested paths (verified via exhaustive grep across all test files):
 *
 * rerank — response model sanitization (safeResponseModel):
 *  1. response.model exceeds 256 chars → safeResponseModel = undefined → modelFallback used
 *  2. response.model is a number → typeof !== 'string' → fallback
 *  3. response.model is a boolean → typeof !== 'string' → fallback
 *  4. response.model is null → typeof null !== 'string' → fallback
 *  5. response.model at exactly 256 chars → accepted as safeResponseModel
 *  6. response.model is empty string → typeof 'string', length 0 ≤ 256 → accepted
 *     (but '' is NOT null/undefined, so '' ?? fallback → '' via nullish coalescing)
 *
 * rerank — response usage sanitization:
 *  7. response.usage with prototype-pollution keys → sanitized to undefined
 *  8. response.usage with NaN token counts → dropped by sanitizer
 *
 * embed_text — total input boundary:
 *  9. Total input chars at exactly MAX_TOTAL_INPUT_CHARS (10_000_000) → accepted
 *
 * decide — score structuredContent sanitization for all-NaN values:
 * 10. All-NaN score array → structuredContent.score mapped to [0, 0, ...]
 *     (text summary tested elsewhere, but structuredContent shape NOT verified)
 *
 * decide — score structuredContent for single-element score:
 * 11. Score array with 1 element → length > 0 is true, processed normally
 */
import { describe, it, expect, vi } from 'vitest';
import { handleRerankDocuments } from '../tool-handlers/rerank.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type RerankSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    model: string;
    results: Array<{ index: number; score: number; document?: string }>;
  };
  _meta: Record<string, unknown>;
};

type EmbedSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
};

type DecideSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    answers: Record<
      string,
      {
        type: string;
        noul?: number;
        choice?: Record<string, number>;
        score?: number[];
      }
    >;
  };
  _meta: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRerankClient(response: unknown, throws?: Error) {
  const rerank = vi.fn();
  if (throws) rerank.mockRejectedValue(throws);
  else rerank.mockResolvedValue(response);
  return { rerank } as unknown as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown, throws?: Error) {
  const createEmbeddings = vi.fn();
  if (throws) createEmbeddings.mockRejectedValue(throws);
  else createEmbeddings.mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown, throws?: Error) {
  const submitDecision = vi.fn();
  if (throws) submitDecision.mockRejectedValue(throws);
  else submitDecision.mockResolvedValue(response);
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

function scoreQuestion(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

// ---------------------------------------------------------------------------
// 1–6. Rerank — response model sanitization (safeResponseModel)
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — response model sanitization', () => {
  it('falls back to effectiveModel when response.model exceeds 256 chars', async () => {
    const longModel = 'x'.repeat(257);
    const client = mockRerankClient({
      model: longModel,
      results: [{ index: 0, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'], model: 'custom/reranker' }),
      client,
    )) as RerankSuccessResult;
    // response.model is too long → safeResponseModel = undefined → uses effectiveModel
    expect(r.structuredContent.model).toBe('custom/reranker');
  });

  it('falls back to effectiveModel when response.model is a number', async () => {
    const client = mockRerankClient({
      model: 12345,
      results: [{ index: 0, score: 0.8 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // typeof 12345 !== 'string' → safeResponseModel = undefined → default model
    expect(r.structuredContent.model).toBe('cohere/rerank-v3.5');
  });

  it('falls back to effectiveModel when response.model is a boolean', async () => {
    const client = mockRerankClient({
      model: true,
      results: [{ index: 0, score: 0.7 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'], model: 'my/model' }),
      client,
    )) as RerankSuccessResult;
    // typeof true !== 'string' → safeResponseModel = undefined → effectiveModel
    expect(r.structuredContent.model).toBe('my/model');
  });

  it('falls back to effectiveModel when response.model is null', async () => {
    const client = mockRerankClient({
      model: null,
      results: [{ index: 0, score: 0.6 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // typeof null !== 'string' → safeResponseModel = undefined → default model
    expect(r.structuredContent.model).toBe('cohere/rerank-v3.5');
  });

  it('accepts response.model at exactly 256 chars', async () => {
    const exactModel = 'a'.repeat(256);
    const client = mockRerankClient({
      model: exactModel,
      results: [{ index: 0, score: 0.5 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // 256 chars ≤ 256 → accepted
    expect(r.structuredContent.model).toBe(exactModel);
  });

  it('uses empty string response.model via nullish coalescing (not null/undefined)', async () => {
    const client = mockRerankClient({
      model: '',
      results: [{ index: 0, score: 0.5 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // '' is typeof 'string' with length 0 ≤ 256 → safeResponseModel = ''
    // '' ?? modelFallback → '' (nullish coalescing doesn't catch empty string)
    expect(r.structuredContent.model).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 7–8. Rerank — response usage sanitization
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — response usage sanitization', () => {
  it('sanitizes response.usage with prototype-pollution keys to undefined', async () => {
    const usage = Object.create(null);
    usage['__proto__'] = 'attack';
    usage['prompt_tokens'] = 10;
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.9 }],
      usage,
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // sanitizeUpstreamUsage returns undefined when any key is unsafe
    expect(r._meta.usage).toBeUndefined();
  });

  it('drops NaN token counts from response.usage', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.9 }],
      usage: { prompt_tokens: NaN, total_tokens: 42 },
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // NaN is not finite → dropped; total_tokens is valid → kept
    expect(r._meta.usage).toEqual({ total_tokens: 42 });
  });

  it('drops Infinity values from response.usage', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.9 }],
      usage: { prompt_tokens: Infinity, cost: 0.01 },
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // Infinity not finite → dropped; cost is finite → kept
    expect(r._meta.usage).toEqual({ cost: 0.01 });
  });
});

// ---------------------------------------------------------------------------
// 9. Embed_text — total input chars at exactly MAX_TOTAL_INPUT_CHARS
// ---------------------------------------------------------------------------

describe('handleEmbedText — total input chars boundary', () => {
  it('accepts total input at exactly 10_000_000 chars', async () => {
    // 100 texts × 100_000 chars each = 10_000_000 exactly
    const texts = Array.from({ length: 100 }, () => 'a'.repeat(100_000));
    const embeddings = texts.map((_, i) => ({ index: i, embedding: [0.1] }));
    const client = mockEmbedClient({
      data: embeddings,
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings).toHaveLength(100);
    expect(r.content[0].text).toContain('100 embedding(s)');
  });

  it('rejects total input at 10_000_001 chars', async () => {
    // 100 texts × 100_000 chars + 1 text of 1 char = 10_000_001
    const texts = Array.from({ length: 100 }, () => 'a'.repeat(100_000));
    texts.push('b'); // pushes total to 10_000_001
    const r = (await handleEmbedText(embedReq({ texts }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('Total input size');
    expect(r.content[0].text).toContain('10000000');
  });
});

// ---------------------------------------------------------------------------
// 10. Decide — score structuredContent sanitization for all-NaN values
// ---------------------------------------------------------------------------

describe('handleDecide — score structuredContent with all-NaN values', () => {
  it('maps all NaN score values to 0 in structuredContent', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [NaN, NaN, NaN] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // Each NaN: typeof === 'number' but isFinite(NaN) === false → mapped to 0
    expect(r.structuredContent.answers.q1.type).toBe('score');
    expect(r.structuredContent.answers.q1.score).toEqual([0, 0, 0]);
  });

  it('maps mixed NaN and finite values correctly in structuredContent score', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [NaN, 0.8, NaN, 0.2] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.score).toEqual([0, 0.8, 0, 0.2]);
  });

  it('text summary for all-NaN score shows 0.0% (displayScore guard)', async () => {
    // When all NaN, maxVal stays at -Infinity → displayScore = 0
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [NaN, NaN] } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: ['low', 'high'] },
        },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).toContain('0.0%');
    expect(r.content[0].text).toContain('level 1/2');
  });
});

// ---------------------------------------------------------------------------
// 11. Decide — score structuredContent with single-element array
// ---------------------------------------------------------------------------

describe('handleDecide — score response with single-element array', () => {
  it('processes score array with exactly 1 element in structuredContent', async () => {
    // length > 0 is true for [0.9], so it enters the processing block
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.9] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.score).toEqual([0.9]);
    expect(r.content[0].text).toContain('level 1/1');
    expect(r.content[0].text).toContain('90.0%');
  });
});

// ---------------------------------------------------------------------------
// Bonus: Rerank — response score sanitization (score field itself)
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — response score sanitization edge cases', () => {
  it('maps Infinity score to 0 via isFinite check, then falls to relevance_score or 0', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: Infinity }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // Infinity: typeof 'number' but !isFinite → falls to relevance_score (undefined) → 0
    expect(r.structuredContent.results[0].score).toBe(0);
  });

  it('maps -Infinity score to 0', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: -Infinity }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    expect(r.structuredContent.results[0].score).toBe(0);
  });

  it('prefers score over relevance_score when both are valid finite numbers', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.95, relevance_score: 0.1 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // score is finite → used directly, relevance_score ignored
    expect(r.structuredContent.results[0].score).toBe(0.95);
  });

  it('falls through to relevance_score when score is undefined', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, relevance_score: 0.77 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // score undefined → typeof undefined !== 'number' → fallthrough
    // relevance_score is finite → used
    expect(r.structuredContent.results[0].score).toBe(0.77);
  });

  it('falls through to relevance_score when score is a string', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 'high', relevance_score: 0.88 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // typeof 'high' !== 'number' → fallthrough to relevance_score
    expect(r.structuredContent.results[0].score).toBe(0.88);
  });

  it('returns 0 when score is a string and relevance_score is also non-finite', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 'bad', relevance_score: Infinity }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as RerankSuccessResult;
    // Both invalid → falls to default 0
    expect(r.structuredContent.results[0].score).toBe(0);
  });
});
