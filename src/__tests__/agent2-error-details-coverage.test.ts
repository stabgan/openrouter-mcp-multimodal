/**
 * Agent 2 — Error details & metadata coverage for embed_text and decide.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets (identified by grepping source code for `_meta.details` fields
 * that no existing test file asserts on):
 *
 * embed_text:
 *  1. `response_keys` in INTERNAL error when embeddings array empty
 *  2. `response_keys` in INTERNAL error when data field missing entirely
 *  3. `first_element_keys` in INTERNAL error when embedding has unexpected shape
 *  4. `first_element_keys` is empty array when first element is null/undefined
 *  5. `first_element_keys` lists actual keys when first element is misshapen
 *  6. Exact structuredContent + _meta shape contract verification
 *
 * decide:
 *  7. `response_keys` in INTERNAL error when answers is empty
 *  8. `response_keys` in INTERNAL error when answers is missing
 *  9. All answers malformed → empty summary text (zero lines)
 *  10. Answer entry is explicitly undefined → skipped in summary
 *  11. noul with null prob → defaults to 0 (NO)
 *  12. _meta.question_count reflects input questions, not output answers
 *  13. Custom model reflected in _meta.model on success
 *  14. score answer with single number among undefined values
 *  15. choice answer with negative probability values
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { SERVER_VERSION } from '../version.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: {
    code: string;
    details?: Record<string, unknown>;
  };
};

type EmbedSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: {
    server_version: string;
    model: string;
    embedding_count: number;
    dimensions: number;
    usage?: Record<string, unknown>;
  };
};

type DecideSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    answers: Record<string, unknown>;
  };
  _meta: {
    server_version: string;
    model: string;
    question_count: number;
    usage?: Record<string, unknown>;
  };
};

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  return {
    submitDecision: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQ(instructions = 'Is this true?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Affirmative', no: 'Negative' },
  };
}

// ---------------------------------------------------------------------------
// 1–2. embed_text — response_keys in INTERNAL error
// ---------------------------------------------------------------------------

describe('handleEmbedText — response_keys detail in INTERNAL errors', () => {
  it('includes response_keys when data array is empty', async () => {
    const client = mockEmbedClient({ data: [], model: 'openai/text-embedding-3-small' });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r._meta.details).toBeDefined();
    expect(r._meta.details!.response_keys).toBeDefined();
    expect(Array.isArray(r._meta.details!.response_keys)).toBe(true);
    expect(r._meta.details!.response_keys).toContain('data');
  });

  it('includes response_keys when data field is undefined', async () => {
    const client = mockEmbedClient({ model: 'test/model', usage: { total_tokens: 5 } });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r._meta.details).toBeDefined();
    expect(r._meta.details!.response_keys).toBeDefined();
    // response has 'model' and 'usage' keys but no 'data'
    expect(r._meta.details!.response_keys).toContain('model');
    expect(r._meta.details!.response_keys).toContain('usage');
  });

  it('includes response_keys for completely empty response object', async () => {
    const client = mockEmbedClient({});
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r._meta.details!.response_keys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3–5. embed_text — first_element_keys detail in unexpected shape error
// ---------------------------------------------------------------------------

describe('handleEmbedText — first_element_keys detail in unexpected shape errors', () => {
  it('includes actual keys when first element is an object without embedding', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, object: 'embedding' }],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
    expect(r._meta.details).toBeDefined();
    expect(r._meta.details!.first_element_keys).toEqual(
      expect.arrayContaining(['index', 'object']),
    );
  });

  it('includes empty array when first element is null', async () => {
    const client = mockEmbedClient({ data: [null] });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    // first is null → first_element_keys should be []
    expect(r._meta.details!.first_element_keys).toEqual([]);
  });

  it('includes empty array when first element is undefined', async () => {
    const client = mockEmbedClient({ data: [undefined] });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    // first is undefined → falsy → first_element_keys should be []
    expect(r._meta.details!.first_element_keys).toEqual([]);
  });

  it('includes keys when first element has embedding as number instead of array', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: 42 }],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.details!.first_element_keys).toEqual(
      expect.arrayContaining(['index', 'embedding']),
    );
  });
});

// ---------------------------------------------------------------------------
// 6. embed_text — exact shape contract verification
// ---------------------------------------------------------------------------

describe('handleEmbedText — exact success response shape contract', () => {
  it('returns all expected fields with correct types', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3] },
        { index: 1, embedding: [0.4, 0.5, 0.6] },
      ],
      model: 'voyage/voyage-3',
      usage: { prompt_tokens: 15, total_tokens: 15 },
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello', 'world'], model: 'voyage/voyage-3', dimensions: 3 }),
      client,
    )) as EmbedSuccessResult;

    // content shape
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
    expect(typeof r.content[0].text).toBe('string');
    expect(r.content[0].text).toContain('2 embedding(s)');
    expect(r.content[0].text).toContain('3 dimensions');
    expect(r.content[0].text).toContain('voyage/voyage-3');

    // structuredContent shape
    expect(r.structuredContent.embeddings).toHaveLength(2);
    expect(r.structuredContent.embeddings[0]).toEqual({ index: 0, embedding: [0.1, 0.2, 0.3] });
    expect(r.structuredContent.embeddings[1]).toEqual({ index: 1, embedding: [0.4, 0.5, 0.6] });
    expect(r.structuredContent.model).toBe('voyage/voyage-3');
    expect(r.structuredContent.dimensions).toBe(3);

    // _meta shape
    expect(r._meta.server_version).toBe(SERVER_VERSION);
    expect(r._meta.model).toBe('voyage/voyage-3');
    expect(r._meta.embedding_count).toBe(2);
    expect(r._meta.dimensions).toBe(3);
    expect(r._meta.usage).toEqual({ prompt_tokens: 15, total_tokens: 15 });
  });
});

// ---------------------------------------------------------------------------
// 7–8. decide — response_keys detail in INTERNAL error
// ---------------------------------------------------------------------------

describe('handleDecide — response_keys detail in INTERNAL errors', () => {
  it('includes response_keys when answers is empty object', async () => {
    const client = mockDecideClient({
      answers: {},
      model: 'typesafe/jev-1.13',
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r._meta.details).toBeDefined();
    expect(r._meta.details!.response_keys).toBeDefined();
    expect(Array.isArray(r._meta.details!.response_keys)).toBe(true);
    expect(r._meta.details!.response_keys).toContain('answers');
  });

  it('includes response_keys when answers field is undefined', async () => {
    const client = mockDecideClient({ model: 'typesafe/jev-1.13', id: 'req-123' });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r._meta.details!.response_keys).toContain('model');
    expect(r._meta.details!.response_keys).toContain('id');
  });

  it('includes response_keys for completely empty response object', async () => {
    const client = mockDecideClient({});
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.details!.response_keys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9–10. decide — all answers malformed & undefined answer entries
// ---------------------------------------------------------------------------

describe('handleDecide — all answers malformed in response', () => {
  it('produces empty summary when all answer entries are non-objects', async () => {
    const client = mockDecideClient({
      answers: {
        q1: 'string-not-object',
        q2: 42,
        q3: true,
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: noulQ(),
          q3: noulQ(),
        },
      }),
      client,
    )) as DecideSuccessResult;
    // All answers are malformed → all skipped → empty summary
    expect(r.content[0].text).toBe('');
  });

  it('skips undefined answer entries in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: undefined,
        q2: { type: 'noul', noul: 0.8 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: noulQ(),
        },
      }),
      client,
    )) as DecideSuccessResult;
    // q1 is undefined → falsy → skipped
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
    expect(lines[0]).toContain('YES');
    expect(lines[0]).toContain('80.0%');
  });
});

// ---------------------------------------------------------------------------
// 11. decide — noul with null prob
// ---------------------------------------------------------------------------

describe('handleDecide — noul with null probability', () => {
  it('treats noul=null as P=0 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: null } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccessResult;
    // null is not a number → prob defaults to 0 → NO at 0.0%
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ---------------------------------------------------------------------------
// 12–13. decide — _meta correctness
// ---------------------------------------------------------------------------

describe('handleDecide — _meta correctness', () => {
  it('question_count reflects input questions, not output answers', async () => {
    // 3 questions submitted, but only 2 answers returned
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.7 },
        q2: { type: 'noul', noul: 0.3 },
        // q3 missing from answers
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: noulQ(),
          q3: noulQ(),
        },
      }),
      client,
    )) as DecideSuccessResult;
    // question_count should be 3 (input), not 2 (output)
    expect(r._meta.question_count).toBe(3);
  });

  it('custom model is reflected in _meta.model', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQ() },
        model: 'microsoft/decision-1',
      }),
      client,
    )) as DecideSuccessResult;
    expect(r._meta.model).toBe('microsoft/decision-1');
    expect(r._meta.server_version).toBe(SERVER_VERSION);
  });

  it('exact success shape contract', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.85 },
      },
      usage: { cost: 0.002 },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccessResult;

    // content
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
    expect(r.content[0].text).toContain('q1');
    expect(r.content[0].text).toContain('YES');
    expect(r.content[0].text).toContain('85.0%');

    // structuredContent
    expect(r.structuredContent.answers).toBeDefined();
    expect(r.structuredContent.answers.q1).toEqual({ type: 'noul', noul: 0.85 });

    // _meta
    expect(r._meta.server_version).toBe(SERVER_VERSION);
    expect(r._meta.model).toBe('typesafe/jev-1.13');
    expect(r._meta.question_count).toBe(1);
    expect(r._meta.usage).toEqual({ cost: 0.002 });
  });
});

// ---------------------------------------------------------------------------
// 14. decide — score answer with single valid number among undefined values
// ---------------------------------------------------------------------------

describe('handleDecide — score with sparse number values', () => {
  it('picks the only valid number in a sparse score array', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [undefined, undefined, 0.95, undefined] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['terrible', 'bad', 'good', 'great'],
          },
        },
      }),
      client,
    )) as DecideSuccessResult;
    // Only index 2 is a number → level 3/4 at 95.0%
    expect(r.content[0].text).toContain('level 3/4');
    expect(r.content[0].text).toContain('95.0%');
  });
});

// ---------------------------------------------------------------------------
// 15. decide — choice answer with negative probability values
// ---------------------------------------------------------------------------

describe('handleDecide — choice with negative probabilities', () => {
  it('picks the highest (least negative) option', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: -0.5, b: -0.1, c: -0.9 } },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick',
            criteria: { a: 'Option A', b: 'Option B', c: 'Option C' },
          },
        },
      }),
      client,
    )) as DecideSuccessResult;
    // -0.1 is the highest → option 'b'
    expect(r.content[0].text).toContain('b');
  });
});
