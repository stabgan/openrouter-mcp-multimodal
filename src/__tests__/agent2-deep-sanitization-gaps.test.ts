/**
 * Deep sanitization and untested-branch coverage for embed_text and decide.
 *
 * Targets branches that no existing test file exercises:
 *
 * embed_text:
 *  - Embedding value sanitization: NaN, Infinity, null, string, object → 0
 *  - Index sanitization: negative, non-integer, non-number → fallback to array position
 *  - Non-array embedding field in data elements → empty array fallback
 *  - Response model string exceeding MAX_MODEL_ID_LENGTH (256) → falls back to effective model
 *
 * decide:
 *  - Unsafe key on individual question objects (unsafeQObjKey check)
 *  - hasDeepUnsafeKey traversing arrays in state
 *  - hasDeepUnsafeKey depth limit (MAX_STATE_NESTING_DEPTH = 32)
 *  - MAX_QUESTIONS_BYTES (1_000_000) aggregate size guard
 *  - Non-serializable questions (circular reference)
 *  - Unknown answer type from upstream (default switch case)
 *  - __proto__ key in upstream answer names (filtered out)
 *  - __proto__ key in upstream choice maps (filtered out)
 *  - Score where all values are non-numeric (all NaN → -Infinity guard → 0%)
 *  - Noul sanitization: non-finite noul stored as undefined in structuredContent
 *  - Choice sanitization: non-object/null choice field
 *  - Score sanitization: non-array score field
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type EmbedSuccess = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
};

type DecideSuccess = {
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

// ===========================================================================
// embed_text — embedding value sanitization
// ===========================================================================

describe('handleEmbedText — embedding value sanitization', () => {
  it('replaces NaN values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, NaN, 0.3] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0, 0.3]);
  });

  it('replaces Infinity values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [Infinity, 0.2, -Infinity] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0.2, 0]);
  });

  it('replaces string values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5, 'bad', 0.7] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.5, 0, 0.7]);
  });

  it('replaces null values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [null, 0.4, null] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0.4, 0]);
  });

  it('replaces object values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [{ nested: true }, 0.6] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0.6]);
  });

  it('replaces undefined values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, undefined, 0.3] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0, 0.3]);
  });

  it('handles batch with mixed clean and dirty embedding values', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, NaN] },
        { index: 1, embedding: [Infinity, 0.5] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0]);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([0, 0.5]);
  });
});

// ===========================================================================
// embed_text — index sanitization
// ===========================================================================

describe('handleEmbedText — index sanitization', () => {
  it('uses array position when upstream index is negative', async () => {
    const client = mockEmbedClient({
      data: [{ index: -1, embedding: [0.1] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });

  it('uses array position when upstream index is NaN', async () => {
    const client = mockEmbedClient({
      data: [
        { index: NaN, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    expect(r.structuredContent.embeddings[1].index).toBe(1);
  });

  it('uses array position when upstream index is not an integer', async () => {
    const client = mockEmbedClient({
      data: [{ index: 1.5, embedding: [0.1] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });

  it('uses array position when upstream index is a string', async () => {
    const client = mockEmbedClient({
      data: [{ index: 'zero', embedding: [0.1] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });

  it('uses array position when upstream index is Infinity', async () => {
    const client = mockEmbedClient({
      data: [{ index: Infinity, embedding: [0.1] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });

  it('preserves valid non-negative integer index from upstream', async () => {
    const client = mockEmbedClient({
      data: [{ index: 5, embedding: [0.1] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].index).toBe(5);
  });
});

// ===========================================================================
// embed_text — non-array embedding fallback
// ===========================================================================

describe('handleEmbedText — non-array embedding fallback in sanitization', () => {
  it('produces empty array when embedding field is a string on non-first element', async () => {
    // First element must have a valid embedding (for the shape check to pass),
    // but subsequent elements with non-array embeddings should get empty arrays.
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: 'not an array' },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0.2]);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });

  it('produces empty array when embedding field is null on non-first element', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.5] },
        { index: 1, embedding: null },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });
});

// ===========================================================================
// embed_text — response model length cap
// ===========================================================================

describe('handleEmbedText — response model length cap', () => {
  it('falls back to effective model when response model exceeds 256 chars', async () => {
    const longModel = 'x'.repeat(257);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: longModel,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    // Should fall back to default model since response model is too long
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
    expect(r._meta.model).toBe('openai/text-embedding-3-small');
    expect(r.content[0].text).toContain('openai/text-embedding-3-small');
  });

  it('falls back to user-provided model when response model exceeds 256 chars', async () => {
    const longModel = 'y'.repeat(257);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: longModel,
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: 'voyage/voyage-3' }),
      client,
    )) as EmbedSuccess;
    expect(r.structuredContent.model).toBe('voyage/voyage-3');
    expect(r._meta.model).toBe('voyage/voyage-3');
  });

  it('uses response model when it is within 256 chars', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-large',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-large');
  });

  it('falls back when response model is a non-string type', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 12345,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
  });
});

// ===========================================================================
// decide — unsafe key on individual question objects (unsafeQObjKey)
// ===========================================================================

describe('handleDecide — unsafe key on question object body', () => {
  it('rejects question object with __proto__ as own property', async () => {
    // The question object itself (not the questions map key) carries __proto__
    const q = Object.create(null);
    q['type'] = 'noul';
    q['instructions'] = 'test';
    q['criteria'] = { yes: 'y', no: 'n' };
    q['__proto__'] = 'injected';
    const r = (await handleDecide(
      decideReq({ questions: { q1: q } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('__proto__');
  });

  it('rejects question object with constructor as own property', async () => {
    const q = Object.create(null);
    q['type'] = 'choice';
    q['instructions'] = 'pick';
    q['criteria'] = { a: 'A', b: 'B' };
    q['constructor'] = 'polluted';
    const r = (await handleDecide(
      decideReq({ questions: { q1: q } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('constructor');
  });

  it('rejects question object with prototype as own property', async () => {
    const q = Object.create(null);
    q['type'] = 'score';
    q['instructions'] = 'rate';
    q['criteria'] = ['bad', 'good'];
    q['prototype'] = {};
    const r = (await handleDecide(
      decideReq({ questions: { q1: q } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('prototype');
  });
});

// ===========================================================================
// decide — hasDeepUnsafeKey traversing arrays in state
// ===========================================================================

describe('handleDecide — deep unsafe key detection in state arrays', () => {
  it('rejects __proto__ nested inside an array in state', async () => {
    const inner = Object.create(null);
    inner['__proto__'] = 'attack';
    inner['safe'] = 'ok';
    const state = { items: [inner] };
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('rejects constructor nested inside a deeply nested array in state', async () => {
    const inner = Object.create(null);
    inner['constructor'] = 'attack';
    inner['ok'] = 'val';
    const state = { level1: { level2: [{ level3: inner }] } };
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('accepts state with deeply nested safe arrays', async () => {
    const state = { items: [{ name: 'a' }, { name: 'b' }], nested: { deep: [1, 2, 3] } };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers).toBeDefined();
  });
});

// ===========================================================================
// decide — MAX_QUESTIONS_BYTES aggregate size guard
// ===========================================================================

describe('handleDecide — questions aggregate size limit', () => {
  it('rejects questions exceeding MAX_QUESTIONS_BYTES (1_000_000)', async () => {
    // 50 questions × (9999 char instructions + 99 criteria × 500 char values)
    // ≈ 50 × (10K + 50K) ≈ 3MB — well over the 1MB limit
    const bigQuestions: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      const criteria: Record<string, string> = {};
      for (let j = 0; j < 99; j++) {
        criteria[`opt_${j}`] = 'v'.repeat(500);
      }
      bigQuestions[`q${i}`] = {
        type: 'choice',
        instructions: 'i'.repeat(9_999),
        criteria,
      };
    }
    const r = (await handleDecide(
      decideReq({ questions: bigQuestions }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('serialized size');
    expect(r.content[0].text).toContain('1000000');
  });

  it('rejects non-serializable questions (BigInt in extra field)', async () => {
    // BigInt is not JSON-serializable but passes field-level validation.
    // We bypass the criteria validation by using valid criteria, then
    // attach an extra non-validated property with BigInt.
    const q: Record<string, unknown> = {
      type: 'noul',
      instructions: 'test',
      criteria: { yes: 'y', no: 'n' },
      extra: BigInt(999),
    };
    const r = (await handleDecide(
      decideReq({ questions: { q1: q } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('not serializable');
  });
});

// ===========================================================================
// decide — unknown answer type from upstream (default switch case)
// ===========================================================================

describe('handleDecide — unknown answer types from upstream', () => {
  it('includes unknown answer type with only type field in structuredContent', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'exotic', probability: 0.99, extra: 'data' },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    // The unknown type should be included with only the `type` field
    const answer = r.structuredContent.answers['q1'];
    expect(answer).toBeDefined();
    expect(answer.type).toBe('exotic');
    // Extra fields should be stripped
    expect((answer as Record<string, unknown>)['probability']).toBeUndefined();
    expect((answer as Record<string, unknown>)['extra']).toBeUndefined();
  });

  it('skips unknown answer type in summary text (no line added)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'exotic', value: 42 },
        q2: { type: 'noul', noul: 0.8 },
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
    )) as DecideSuccess;
    // q1 has unknown type → not in summary; q2 has noul → in summary
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('q2');
    expect(lines[0]).toContain('YES');
  });
});

// ===========================================================================
// decide — __proto__ key in upstream answer names
// ===========================================================================

describe('handleDecide — unsafe keys in upstream answer names', () => {
  it('filters out __proto__ key from upstream answers', async () => {
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.9 };
    answers['q1'] = { type: 'noul', noul: 0.7 };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    // __proto__ should be filtered; q1 should be present
    expect(r.structuredContent.answers['q1']).toBeDefined();
    expect(Object.hasOwn(r.structuredContent.answers, '__proto__')).toBe(false);
  });

  it('filters out constructor key from upstream answers', async () => {
    const answers = Object.create(null);
    answers['constructor'] = { type: 'noul', noul: 0.5 };
    answers['q1'] = { type: 'choice', choice: { a: 0.6, b: 0.4 } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']).toBeDefined();
    expect(Object.hasOwn(r.structuredContent.answers, 'constructor')).toBe(false);
  });

  it('filters out prototype key from upstream answers', async () => {
    const answers = Object.create(null);
    answers['prototype'] = { type: 'score', score: [0.5, 0.5] };
    answers['q1'] = { type: 'noul', noul: 0.3 };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']).toBeDefined();
    expect(Object.hasOwn(r.structuredContent.answers, 'prototype')).toBe(false);
  });
});

// ===========================================================================
// decide — __proto__ key in upstream choice maps
// ===========================================================================

describe('handleDecide — unsafe keys in upstream choice probability maps', () => {
  it('filters __proto__ from choice probability map', async () => {
    const choice = Object.create(null);
    choice['__proto__'] = 0.9;
    choice['red'] = 0.6;
    choice['blue'] = 0.4;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    const sanitizedChoice = r.structuredContent.answers['q1']?.choice;
    expect(sanitizedChoice).toBeDefined();
    // __proto__ should be stripped — check own keys only
    expect(Object.hasOwn(sanitizedChoice!, '__proto__')).toBe(false);
    expect(sanitizedChoice!['red']).toBe(0.6);
    expect(sanitizedChoice!['blue']).toBe(0.4);
  });

  it('filters constructor from choice probability map', async () => {
    const choice = Object.create(null);
    choice['constructor'] = 0.5;
    choice['a'] = 0.3;
    choice['b'] = 0.7;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    const sanitizedChoice = r.structuredContent.answers['q1']?.choice;
    expect(Object.hasOwn(sanitizedChoice!, 'constructor')).toBe(false);
    expect(sanitizedChoice!['a']).toBe(0.3);
    expect(sanitizedChoice!['b']).toBe(0.7);
  });
});

// ===========================================================================
// decide — score where all values are non-numeric (-Infinity guard)
// ===========================================================================

describe('handleDecide — score with all non-numeric values', () => {
  it('displays 0% when all score values are NaN', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [NaN, NaN, NaN] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.content[0].text).toContain('0.0%');
    // level 1/3 since maxIdx stays at 0
    expect(r.content[0].text).toContain('level 1/3');
  });

  it('displays 0% when all score values are non-numeric types', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: ['bad', null, undefined] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.content[0].text).toContain('0.0%');
  });

  it('sanitizes score array in structuredContent replacing non-numeric with 0', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [NaN, 0.5, 'bad', null] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.score).toEqual([0, 0.5, 0, 0]);
  });
});

// ===========================================================================
// decide — noul sanitization in structuredContent
// ===========================================================================

describe('handleDecide — noul sanitization in structuredContent', () => {
  it('sets noul to undefined in structuredContent when upstream value is NaN', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: NaN } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.noul).toBeUndefined();
  });

  it('sets noul to undefined in structuredContent when upstream value is Infinity', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: Infinity } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.noul).toBeUndefined();
  });

  it('sets noul to undefined in structuredContent when upstream value is a string', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 'high' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.noul).toBeUndefined();
  });

  it('preserves valid finite noul in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.73 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.noul).toBe(0.73);
  });
});

// ===========================================================================
// decide — choice sanitization with non-object choice field
// ===========================================================================

describe('handleDecide — choice sanitization edge cases', () => {
  it('returns empty choice map when answer.choice is null', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: null } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.choice).toEqual({});
  });

  it('returns empty choice map when answer.choice is a string', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: 'red' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.choice).toEqual({});
  });

  it('returns empty choice map when answer.choice is a number', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: 42 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.choice).toEqual({});
  });

  it('filters Infinity values from choice probability map', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: 0.3, b: Infinity, c: -Infinity } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.choice).toEqual({ a: 0.3 });
  });
});

// ===========================================================================
// decide — score sanitization with non-array score field
// ===========================================================================

describe('handleDecide — score sanitization edge cases', () => {
  it('returns undefined score in structuredContent when answer.score is null', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: null } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.score).toBeUndefined();
  });

  it('returns undefined score in structuredContent when answer.score is a string', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: 'high' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.score).toBeUndefined();
  });

  it('returns undefined score when answer.score is an empty array', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers['q1']?.score).toBeUndefined();
  });
});

// ===========================================================================
// decide — hasDeepUnsafeKey depth limit
// ===========================================================================

describe('handleDecide — deep nesting depth limit in state', () => {
  it('accepts state with nesting at depth 32 (no false positive from depth cap)', async () => {
    // Build a deeply nested object at exactly depth 32
    let state: Record<string, unknown> = { leaf: 'value' };
    for (let i = 0; i < 31; i++) {
      state = { inner: state };
    }
    // 32 nesting levels × ~10 chars per level ≈ 320 chars — well under 100KB
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('does not detect unsafe keys beyond depth 32 (depth cap prevents stack overflow)', async () => {
    // Build a deeply nested object with __proto__ beyond depth 32
    const inner = Object.create(null);
    inner['__proto__'] = 'attack';
    inner['safe'] = 'val';
    let state: Record<string, unknown> = inner;
    for (let i = 0; i < 33; i++) {
      state = { inner: state };
    }
    // 34 nesting levels × ~10 chars per level ≈ 340 chars — well under 100KB.
    // At depth > 32 the scanner stops — the unsafe key will NOT be detected
    // and the request will proceed to the API call
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers).toBeDefined();
  });
});
