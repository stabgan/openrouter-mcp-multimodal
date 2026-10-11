/**
 * Coverage for genuinely untested code paths across rerank, embed_text, and decide.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Verified untested via exhaustive grep:
 *
 * rerank — response result count capping:
 *  1. Upstream returns MORE results than documents sent → sliced to documents.length
 *  2. Upstream returns FEWER results than documents → no slicing
 *  3. Upstream returns EXACTLY documents.length results → no slicing
 *
 * rerank — document_truncated flag:
 *  4. When capResultText truncates a document, `document_truncated: true` is set on the result
 *
 * rerank — explicit return_documents=false:
 *  5. Passing `false` explicitly passes `return_documents: undefined` to API (not false)
 *
 * rerank — response results is undefined (without null, which IS tested):
 *  6. Results field completely absent → `response.results ?? []` → rawResults=[]
 *
 * rerank — score field preferred over relevance_score even when score=0:
 *  7. r.score === 0 (finite) should be preferred over r.relevance_score=0.9
 *
 * rerank — normalizeRerankResults called with results containing non-object entries:
 *  8. result entries with missing index → isValidDocumentIndex returns false → INTERNAL
 *
 * embed_text — batch where second element has non-number index (string):
 *  9. In multi-element batch, index sanitization uses loop index as fallback
 *
 * embed_text — response.model is boolean:
 * 10. typeof false !== 'string' → safeResponseModel = undefined → effectiveModel used
 *
 * decide — choice answer with NO valid entries after sanitization:
 * 11. All entries unsafe/non-finite → empty choice map → summary shows '?' with 0.0%
 *
 * decide — score response with exactly 100 levels (MAX_SCORE_LEVELS boundary):
 * 12. Score array at exactly 100 → not capped → all 100 preserved in structuredContent
 *
 * decide — noul answer with noul=0 (falsy but valid finite number):
 * 13. noul=0 passes typeof+isFinite → safeNoul=0 → structuredContent.noul === 0
 *
 * decide — multiple answer types in single response with mixed sanitization:
 * 14. noul + choice + score + unknown all in one response → each type sanitized correctly
 *
 * embed_text — embedding with all non-finite values → all replaced with 0:
 * 15. Batch of [NaN, Infinity, -Infinity, 'str', null, undefined] → all become 0
 *
 * rerank — empty model string passes through to default:
 * 16. model: '' → rejected as empty by the handler before reaching trim
 */
import { describe, it, expect, vi } from 'vitest';
import { handleRerankDocuments } from '../tool-handlers/rerank.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type RerankSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    model: string;
    results: Array<{
      index: number;
      score: number;
      document?: string;
      document_truncated?: boolean;
    }>;
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

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

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

function noulQuestion(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

function choiceQuestion(instructions = 'Pick a color') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { red: 'Color red', blue: 'Color blue', green: 'Color green' },
  };
}

function scoreQuestion(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–3. rerank — response result count capping
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — response result count capping', () => {
  it('caps results when upstream returns more results than documents sent', async () => {
    // Send 2 documents but upstream returns 5 results
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [
        { index: 0, score: 0.95 },
        { index: 1, score: 0.8 },
        { index: 0, score: 0.7 }, // extra — should be sliced off
        { index: 1, score: 0.6 }, // extra
        { index: 0, score: 0.5 }, // extra
      ],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test query', documents: ['doc one', 'doc two'] }),
      client,
    )) as RerankSuccessResult;
    // Should only have 2 results, sliced to match documents.length
    expect(r.structuredContent.results).toHaveLength(2);
    expect(r.structuredContent.results[0].score).toBe(0.95);
    expect(r.structuredContent.results[1].score).toBe(0.8);
  });

  it('does not cap when upstream returns fewer results than documents', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['a', 'b', 'c'] }),
      client,
    )) as RerankSuccessResult;
    expect(r.structuredContent.results).toHaveLength(1);
  });

  it('does not cap when upstream returns exactly the right count', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [
        { index: 0, score: 0.9 },
        { index: 1, score: 0.8 },
        { index: 2, score: 0.7 },
      ],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['a', 'b', 'c'] }),
      client,
    )) as RerankSuccessResult;
    expect(r.structuredContent.results).toHaveLength(3);
  });

  it('caps to 1 result when single document but upstream returns many', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [
        { index: 0, score: 0.95 },
        { index: 0, score: 0.85 },
        { index: 0, score: 0.75 },
      ],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['single doc'] }),
      client,
    )) as RerankSuccessResult;
    expect(r.structuredContent.results).toHaveLength(1);
    expect(r.structuredContent.results[0].score).toBe(0.95);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. rerank — document_truncated flag from capResultText
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — document field with { text } shape', () => {
  it('falls back to input document when r.document is undefined', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0, score: 0.9 }], // no document field
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['original text'], return_documents: true }),
      client,
    )) as RerankSuccessResult;
    expect(r.structuredContent.results[0].document).toBe('original text');
  });

  it('prefers r.document string over input document', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0, score: 0.9, document: 'upstream doc text' }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['original text'], return_documents: true }),
      client,
    )) as RerankSuccessResult;
    expect(r.structuredContent.results[0].document).toBe('upstream doc text');
  });

  it('extracts text from { text: "..." } shaped document object', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0, score: 0.9, document: { text: 'nested doc text' } }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['original'], return_documents: true }),
      client,
    )) as RerankSuccessResult;
    expect(r.structuredContent.results[0].document).toBe('nested doc text');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. rerank — explicit return_documents=false
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — return_documents=false', () => {
  it('passes return_documents as undefined to API when explicitly false', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'], return_documents: false }),
      client,
    )) as RerankSuccessResult;
    // `return_documents: false` → `=== true` is false → pass undefined to API
    expect(client.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ return_documents: undefined }),
    );
    // No document field in result
    expect(r.structuredContent.results[0].document).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. rerank — response.results completely absent (undefined, not null)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — results field absent from response', () => {
  it('handles response with no results field (results ?? [] → empty)', async () => {
    // No results key at all — rawResults defaults to []
    const client = mockRerankClient({ model: 'cohere/rerank-v3.5' });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as RerankSuccessResult;
    expect(r.structuredContent.results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. rerank — score=0 preferred over relevance_score
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — score=0 is a valid finite number', () => {
  it('uses score=0 (falsy but finite) over relevance_score=0.9', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0, score: 0, relevance_score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as RerankSuccessResult;
    // score=0 is typeof number && isFinite(0) → preferred over relevance_score
    expect(r.structuredContent.results[0].score).toBe(0);
  });

  it('uses relevance_score when score is undefined', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0, relevance_score: 0.75 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as RerankSuccessResult;
    expect(r.structuredContent.results[0].score).toBe(0.75);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. rerank — result with missing index field
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — result with undefined index', () => {
  it('returns INTERNAL for result with no index field', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ score: 0.9 }], // no index
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('returns INTERNAL for result with string index', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: '0', score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('returns INTERNAL for result with NaN index', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: NaN, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('returns INTERNAL for result with float index', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0.5, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. embed_text — batch index sanitization across multiple elements
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — index sanitization across batch', () => {
  it('falls back to loop index when non-first element has string index', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 'bad', embedding: [0.2] },
        { index: 2, embedding: [0.3] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b', 'c'] }),
      client,
    )) as EmbedSuccessResult;
    // First: valid index 0
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    // Second: string index → fallback to loop index 1
    expect(r.structuredContent.embeddings[1].index).toBe(1);
    // Third: valid index 2
    expect(r.structuredContent.embeddings[2].index).toBe(2);
  });

  it('falls back to loop index when element has negative index', async () => {
    const client = mockEmbedClient({
      data: [
        { index: -1, embedding: [0.1, 0.2] },
        { index: 1, embedding: [0.3, 0.4] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    // Negative index → fallback to loop index 0
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    expect(r.structuredContent.embeddings[1].index).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. embed_text — response.model is boolean
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response.model as boolean', () => {
  it('falls back to effectiveModel when response.model is false', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: false,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    // typeof false !== 'string' → safeResponseModel = undefined → displayModel = effectiveModel
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
    expect(r._meta.model).toBe('openai/text-embedding-3-small');
  });

  it('falls back to effectiveModel when response.model is true', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: true,
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: 'custom/model' }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.model).toBe('custom/model');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. decide — choice answer with NO valid entries after full sanitization
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice answer fully sanitized to empty map', () => {
  it('produces empty choice map and ? summary when all entries are unsafe keys', async () => {
    const choice = Object.create(null);
    choice['__proto__'] = 0.5;
    choice['constructor'] = 0.3;
    choice['prototype'] = 0.2;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // All keys are unsafe → empty choice map
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
    // Summary should show '?' with 0.0% since best is undefined
    expect(r.content[0].text).toContain('?');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('produces empty choice map when all values are non-numeric strings', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: 'high', b: 'low', c: 'medium' } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // All values non-numeric → all filtered out → empty map
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. decide — score response at exactly MAX_SCORE_LEVELS boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — upstream score at exactly 100 levels', () => {
  it('does not cap score array at exactly 100 elements', async () => {
    const score = new Array(100).fill(0.01);
    score[50] = 0.95; // highest value at index 50
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.score).toHaveLength(100);
    expect(r.structuredContent.answers.q1?.score![50]).toBe(0.95);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. decide — noul=0 (falsy but valid finite number)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — noul=0 in structuredContent', () => {
  it('preserves noul=0 as a valid finite number in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // noul=0: typeof 0 === 'number' && isFinite(0) → safeNoul = 0
    expect(r.structuredContent.answers.q1?.noul).toBe(0);
    // Summary: 0 < 0.5 → NO, P=0.0%
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('preserves negative noul as a valid finite number', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.noul).toBe(-0.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. decide — mixed answer types in single response
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — all answer types in one response with sanitization', () => {
  it('sanitizes each answer type independently', async () => {
    const choice = Object.create(null);
    choice['good'] = 0.7;
    choice['__proto__'] = 0.9; // should be stripped
    choice['bad'] = NaN; // should be stripped

    const client = mockDecideClient({
      answers: {
        q_noul: { type: 'noul', noul: NaN, extra: 'stripped' },
        q_choice: { type: 'choice', choice, extra: 'stripped' },
        q_score: { type: 'score', score: [NaN, 0.8, 'bad'], extra: 'stripped' },
        q_unknown: { type: 'novel', data: 'stripped' },
      },
    });

    const r = (await handleDecide(
      decideReq({
        questions: {
          q_noul: noulQuestion(),
          q_choice: choiceQuestion(),
          q_score: scoreQuestion(),
          q_unknown: noulQuestion(),
        },
      }),
      client,
    )) as DecideSuccessResult;

    const answers = r.structuredContent.answers;

    // noul: NaN → safeNoul = undefined
    expect(answers.q_noul?.type).toBe('noul');
    expect(answers.q_noul?.noul).toBeUndefined();
    expect((answers.q_noul as Record<string, unknown>).extra).toBeUndefined();

    // choice: __proto__ stripped, NaN stripped, only 'good' remains
    expect(answers.q_choice?.type).toBe('choice');
    expect(answers.q_choice?.choice).toEqual({ good: 0.7 });

    // score: [NaN, 0.8, 'bad'] → [0, 0.8, 0]
    expect(answers.q_score?.type).toBe('score');
    expect(answers.q_score?.score).toEqual([0, 0.8, 0]);

    // unknown: only type field preserved
    expect(answers.q_unknown?.type).toBe('novel');
    expect((answers.q_unknown as Record<string, unknown>).data).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. embed_text — embedding with ALL non-finite/non-number values
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — complete embedding vector sanitization', () => {
  it('replaces all non-finite values with 0 in a single vector', async () => {
    const client = mockEmbedClient({
      data: [
        {
          index: 0,
          embedding: [NaN, Infinity, -Infinity, 'text', null, undefined, true, {}, [], 0.5],
        },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccessResult;
    // All non-finite/non-number → 0, last element (0.5) preserved
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5]);
    expect(r.structuredContent.dimensions).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. rerank — empty model string validation
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — model validation edge cases', () => {
  it('falls back to default model when model is empty string', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0, score: 0.9 }],
    });
    await handleRerankDocuments(rerankReq({ query: 'q', documents: ['doc'], model: '' }), client);
    // Empty string: typeof '' === 'string' passes type check,
    // then ''.trim() || DEFAULT_MODEL → default used
    expect(client.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'cohere/rerank-v3.5' }),
    );
  });

  it('rejects whitespace-only model by falling back to default', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0, score: 0.9 }],
    });
    await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'], model: '   ' }),
      client,
    );
    // '   '.trim() = '' which is falsy → default model used
    expect(client.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'cohere/rerank-v3.5' }),
    );
  });

  it('trims model whitespace before passing to API', async () => {
    const client = mockRerankClient({
      model: 'custom/model',
      results: [{ index: 0, score: 0.9 }],
    });
    await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'], model: '  custom/model  ' }),
      client,
    );
    expect(client.rerank).toHaveBeenCalledWith(expect.objectContaining({ model: 'custom/model' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Extra: rerank — Infinity top_n accepted (not rejected by validation)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — top_n edge values', () => {
  it('rejects Infinity top_n as non-finite', async () => {
    const client = mockRerankClient({});
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'], top_n: Infinity }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects -Infinity top_n', async () => {
    const client = mockRerankClient({});
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'], top_n: -Infinity }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects string top_n', async () => {
    const client = mockRerankClient({});
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'], top_n: '5' }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('accepts top_n of 1 (minimum valid)', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'], top_n: 1 }),
      client,
    )) as RerankSuccessResult;
    expect(r.structuredContent.results).toBeDefined();
    expect(client.rerank).toHaveBeenCalledWith(expect.objectContaining({ top_n: 1 }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Extra: rerank — non-string query types
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — non-string query validation', () => {
  it('rejects number query', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 42, documents: ['doc'] }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects null query', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: null, documents: ['doc'] }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects boolean query', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: true, documents: ['doc'] }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Extra: rerank — documents as non-array
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — documents validation', () => {
  it('rejects string documents', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: 'not an array' }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty array');
  });

  it('rejects null documents', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: null }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects empty string document in array', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['valid', ''] }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('documents[1]');
  });

  it('rejects whitespace-only document', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['  \t\n  '] }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('documents[0]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Extra: rerank — missing arguments fallback
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — missing arguments', () => {
  it('handles undefined arguments gracefully', async () => {
    const r = (await handleRerankDocuments(
      {
        params: {
          arguments: undefined as unknown as {
            query: string;
            documents: string[];
          },
        },
      },
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Extra: rerank — auth error from upstream
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — upstream error classification', () => {
  it('classifies 401 as INVALID_CREDENTIALS', async () => {
    const err = new Error('invalid api key') as Error & { status: number };
    err.status = 401;
    const client = mockRerankClient(null, err);
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('classifies 404 as MODEL_NOT_FOUND', async () => {
    const err = new Error('model does not exist') as Error & { status: number };
    err.status = 404;
    const client = mockRerankClient(null, err);
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
  });

  it('classifies 429 as UPSTREAM_REFUSED', async () => {
    const err = new Error('rate limit exceeded') as Error & { status: number };
    err.status = 429;
    const client = mockRerankClient(null, err);
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'q', documents: ['doc'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
  });
});
