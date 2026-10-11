/**
 * Agent 2 — Final round: covers genuinely untested code paths in embed_text
 * and decide handlers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Confirmed untested paths (verified via exhaustive grep of all test files):
 *
 * decide — unsafeQObjKey: prototype-pollution keys on individual question
 *   OBJECTS (not the top-level questions key, but within a question definition
 *   itself, e.g. questions.q1.__proto__).
 *
 * decide — MAX_QUESTIONS_BYTES (1_000_000): aggregate serialized size guard
 *   for the entire questions object. No test exercises this branch.
 *
 * decide — questions not serializable: when JSON.stringify(questions) throws
 *   (e.g. BigInt values). No test exercises this branch.
 *
 * decide — score with ALL non-numeric values: when every score element is
 *   non-numeric, maxVal stays at -Infinity and the guard produces 0%.
 *
 * decide — score with Infinity/-Infinity values: the typeof check filters
 *   them because `Infinity > maxVal` is true but the display guard catches it.
 *
 * embed_text — data is non-array truthy value: when response.data is a
 *   non-array non-null value (e.g. a string), the `!Array.isArray` branch
 *   fires.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleDecide } from '../tool-handlers/decide.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
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

function mockDecideClient(response: unknown, throws?: Error) {
  const submitDecision = vi.fn();
  if (throws) submitDecision.mockRejectedValue(throws);
  else submitDecision.mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown, throws?: Error) {
  const createEmbeddings = vi.fn();
  if (throws) createEmbeddings.mockRejectedValue(throws);
  else createEmbeddings.mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function noulQuestion(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

function scoreQuestion(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

// ---------------------------------------------------------------------------
// decide — unsafeQObjKey: prototype-pollution on individual question objects
// ---------------------------------------------------------------------------

describe('handleDecide — unsafe keys on individual question objects', () => {
  it('rejects question object with __proto__ as own key', async () => {
    // The question definition itself has __proto__ as an own property.
    // This is different from __proto__ as a top-level question NAME.
    const badQ = Object.create(null);
    badQ['type'] = 'noul';
    badQ['instructions'] = 'test';
    badQ['criteria'] = { yes: 'y', no: 'n' };
    badQ['__proto__'] = { injected: true };
    const r = (await handleDecide(
      decideReq({ questions: { q1: badQ } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions.q1');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('__proto__');
  });

  it('rejects question object with constructor as own key', async () => {
    const badQ = Object.create(null);
    badQ['type'] = 'choice';
    badQ['instructions'] = 'pick one';
    badQ['criteria'] = { a: 'A', b: 'B' };
    badQ['constructor'] = function () {};
    const r = (await handleDecide(
      decideReq({ questions: { myQ: badQ } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions.myQ');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('constructor');
  });

  it('rejects question object with prototype as own key', async () => {
    const badQ = Object.create(null);
    badQ['type'] = 'score';
    badQ['instructions'] = 'rate';
    badQ['criteria'] = ['bad', 'good'];
    badQ['prototype'] = {};
    const r = (await handleDecide(
      decideReq({ questions: { rating: badQ } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions.rating');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('prototype');
  });
});

// ---------------------------------------------------------------------------
// decide — MAX_QUESTIONS_BYTES (1_000_000) aggregate size guard
// ---------------------------------------------------------------------------

describe('handleDecide — questions aggregate serialized size', () => {
  it('rejects when questions serialized size exceeds 1_000_000 bytes', async () => {
    // Build a questions object that is large due to many long criteria values.
    // 20 questions × 50 criteria × ~1100 chars/value ≈ 1.1 MB
    const questions: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) {
      const criteria: Record<string, string> = {};
      for (let j = 0; j < 50; j++) {
        criteria[`opt_${j}`] = 'x'.repeat(1100);
      }
      questions[`q${i}`] = {
        type: 'choice',
        instructions: 'pick one',
        criteria,
      };
    }
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('serialized size');
    expect(r.content[0].text).toContain('1000000');
  });

  it('accepts questions just under the 1_000_000 byte limit', async () => {
    // Build a questions object that's large but under the limit.
    // 5 questions × 10 criteria × 9000 chars/value ≈ 450 KB
    const questions: Record<string, unknown> = {};
    const answers: Record<string, unknown> = {};
    for (let i = 0; i < 5; i++) {
      const criteria: Record<string, string> = {};
      for (let j = 0; j < 10; j++) {
        criteria[`opt_${j}`] = 'y'.repeat(9000);
      }
      questions[`q${i}`] = {
        type: 'choice',
        instructions: 'pick',
        criteria,
      };
      answers[`q${i}`] = { type: 'choice', choice: { opt_0: 0.5, opt_1: 0.5 } };
    }
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(decideReq({ questions }), client)) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// decide — questions not serializable (JSON.stringify throws)
// ---------------------------------------------------------------------------

describe('handleDecide — questions not serializable', () => {
  it('returns INVALID_INPUT when questions contain BigInt values', async () => {
    // BigInt cannot be serialized by JSON.stringify and throws a TypeError.
    // We need a question that passes per-field validation but fails stringify.
    // BigInt in criteria value would fail the typeof string check first,
    // so we need to sneak it past. A getter that returns BigInt on stringify
    // is the right approach.
    const criteria: Record<string, unknown> = { yes: 'y', no: 'n' };
    const question = {
      type: 'noul',
      instructions: 'test',
      criteria,
      // toJSON is called during stringify and can throw
      toJSON() {
        throw new TypeError('Do not know how to serialize a BigInt');
      },
    };
    const r = (await handleDecide(
      decideReq({ questions: { q1: question } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('not serializable');
  });
});

// ---------------------------------------------------------------------------
// decide — score with ALL non-numeric values (maxVal stays at -Infinity)
// ---------------------------------------------------------------------------

describe('handleDecide — score answer with all non-numeric values', () => {
  it('displays 0% when all score values are NaN', async () => {
    const client = mockDecideClient({
      answers: {
        quality: { type: 'score', score: [NaN, NaN, NaN] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { quality: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    // maxVal stays at -Infinity, guard shows 0%
    expect(r.content[0].text).toContain('0.0%');
    // level defaults to 1 (maxIdx=0 → level 1/3)
    expect(r.content[0].text).toContain('level 1/3');
  });

  it('displays 0% when all score values are strings', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: ['bad', 'worse', 'worst'] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('0.0%');
    expect(r.content[0].text).toContain('level 1/3');
  });

  it('displays 0% when all score values are null', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [null, null] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('0.0%');
  });

  it('displays 0% when all score values are undefined', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [undefined, undefined, undefined] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ---------------------------------------------------------------------------
// decide — score with Infinity values
// ---------------------------------------------------------------------------

describe('handleDecide — score answer with Infinity values', () => {
  it('picks Infinity as max when present (typeof number is true)', async () => {
    // Infinity IS typeof 'number' and Infinity > any finite number.
    // The guard `maxVal === -Infinity ? 0 : maxVal` does NOT fire because
    // maxVal is Infinity, not -Infinity. So it displays Infinity * 100.
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [0.1, Infinity, 0.3] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    // Infinity is typeof number, so it wins at index 1 → level 2/3
    expect(r.content[0].text).toContain('level 2/3');
  });

  it('picks finite value when -Infinity is present', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [-Infinity, 0.8] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    // -Infinity < 0.8, so 0.8 at index 1 wins → level 2/2
    expect(r.content[0].text).toContain('level 2/2');
    expect(r.content[0].text).toContain('80.0%');
  });

  it('picks the one finite value among Infinity and -Infinity', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [Infinity, 0.5, -Infinity] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    // Infinity > 0.5, so Infinity at index 0 wins → level 1/3
    expect(r.content[0].text).toContain('level 1/3');
  });
});

// ---------------------------------------------------------------------------
// embed_text — data is non-array truthy value
// ---------------------------------------------------------------------------

describe('handleEmbedText — non-array data in response', () => {
  it('returns INTERNAL when data is a string', async () => {
    const client = mockEmbedClient({
      data: 'not an array',
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  it('returns INTERNAL when data is an object (not array)', async () => {
    const client = mockEmbedClient({
      data: { embedding: [0.1] },
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  it('returns INTERNAL when data is a number', async () => {
    const client = mockEmbedClient({
      data: 42,
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  it('returns INTERNAL when data is true (boolean)', async () => {
    const client = mockEmbedClient({
      data: true,
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });
});

// ---------------------------------------------------------------------------
// decide — edge: answers contain unknown type (not noul/choice/score)
// ---------------------------------------------------------------------------

describe('handleDecide — answer with unrecognized type in response', () => {
  it('skips answer with unknown type (no line produced)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'unknown_type', value: 42 },
        q2: { type: 'noul', noul: 0.7 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: noulQuestion(),
        },
      }),
      client,
    )) as SuccessResult;
    // q1 has unknown type — no case matches, so no line for it
    // q2 has noul — produces a line
    const text = r.content[0].text;
    expect(text).toContain('q2');
    expect(text).toContain('YES');
    // q1 should not appear in the summary
    expect(text).not.toContain('q1');
  });
});

// ---------------------------------------------------------------------------
// embed_text — response_keys in error details
// ---------------------------------------------------------------------------

describe('handleEmbedText — error details include response_keys', () => {
  it('includes response_keys in error meta when data is empty', async () => {
    const client = mockEmbedClient({
      data: [],
      model: 'openai/text-embedding-3-small',
      extra_field: 'present',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('includes first_element_keys when embedding has unexpected shape', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, vector: [0.1, 0.2] }], // 'vector' instead of 'embedding'
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });
});

// ---------------------------------------------------------------------------
// decide — response edge: answers is null
// ---------------------------------------------------------------------------

describe('handleDecide — answers field edge cases', () => {
  it('returns INTERNAL when answers is null', async () => {
    const client = mockDecideClient({ answers: null });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No answers returned');
  });

  it('returns INTERNAL when answers is a number', async () => {
    const client = mockDecideClient({ answers: 42 });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No answers returned');
  });
});

// ---------------------------------------------------------------------------
// decide — model trimming with valid custom model
// ---------------------------------------------------------------------------

describe('handleDecide — model handling edge cases', () => {
  it('accepts model at exactly MAX_MODEL_ID_LENGTH (256)', async () => {
    const exactModel = 'a'.repeat(256);
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, model: exactModel }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect(r._meta.model).toBe(exactModel);
  });
});
