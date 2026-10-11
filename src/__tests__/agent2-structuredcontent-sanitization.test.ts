/**
 * Agent 2 — structuredContent sanitization verification for decide and embed_text.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * These tests verify the *structuredContent shape* after response sanitization,
 * which existing tests do not cover. Existing tests check:
 *   - text summary formatting (YES/NO, level X/Y, etc.)
 *   - that unsafe keys are stripped from answer names
 *   - that unsafe keys are stripped from choice maps
 *
 * This file verifies:
 *   decide — sanitized structuredContent shape:
 *    1. noul with NaN → structuredContent has noul: undefined (safeNoul path)
 *    2. noul with Infinity → structuredContent has noul: undefined
 *    3. noul with string value → structuredContent has noul: undefined
 *    4. noul with missing noul field → structuredContent has noul: undefined
 *    5. score with non-numeric entries → structuredContent maps to 0
 *    6. score with non-array value → structuredContent has score: undefined
 *    7. score with empty array → structuredContent has score: undefined
 *    8. unknown answer type → structuredContent has only { type } field
 *    9. choice with non-numeric values → stripped from structuredContent
 *   10. choice with mixed valid/invalid → only valid remain in structuredContent
 *   11. answers is null → INTERNAL error
 *   12. answers is a number → INTERNAL error
 *
 *   embed_text — response type edge cases:
 *   13. data is a string → INTERNAL error
 *   14. data is a boolean → INTERNAL error
 *   15. data is a number → INTERNAL error
 *   16. first element has extra keys → first_element_keys detail populated
 */
import { describe, it, expect, vi } from 'vitest';
import { handleDecide } from '../tool-handlers/decide.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; details?: Record<string, unknown> };
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

function mockDecideClient(response: unknown) {
  return {
    submitDecision: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
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

// ---------------------------------------------------------------------------
// 1–4. decide — noul sanitization in structuredContent
// ---------------------------------------------------------------------------

describe('handleDecide — noul sanitization in structuredContent', () => {
  it('sets noul to undefined in structuredContent when upstream noul is NaN', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: NaN } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('noul');
    expect(r.structuredContent.answers.q1.noul).toBeUndefined();
  });

  it('sets noul to undefined in structuredContent when upstream noul is Infinity', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: Infinity } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('noul');
    expect(r.structuredContent.answers.q1.noul).toBeUndefined();
  });

  it('sets noul to undefined in structuredContent when upstream noul is a string', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 'high' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('noul');
    expect(r.structuredContent.answers.q1.noul).toBeUndefined();
  });

  it('sets noul to undefined in structuredContent when noul field is missing', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('noul');
    expect(r.structuredContent.answers.q1.noul).toBeUndefined();
  });

  it('preserves finite noul value in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.73 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.noul).toBe(0.73);
  });

  it('preserves noul=0 (finite) in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.noul).toBe(0);
  });

  it('strips extra upstream properties from noul answers in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8, extra_field: 'dangerous', nested: {} } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // Only type and noul should be present
    expect(Object.keys(r.structuredContent.answers.q1)).toEqual(
      expect.arrayContaining(['type', 'noul']),
    );
    expect(Object.keys(r.structuredContent.answers.q1)).toHaveLength(2);
    expect(
      (r.structuredContent.answers.q1 as Record<string, unknown>)['extra_field'],
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5–7. decide — score sanitization in structuredContent
// ---------------------------------------------------------------------------

describe('handleDecide — score sanitization in structuredContent', () => {
  it('maps non-numeric score entries to 0 in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: ['bad', 0.3, null, 0.7] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('score');
    expect(r.structuredContent.answers.q1.score).toEqual([0, 0.3, 0, 0.7]);
  });

  it('maps NaN and Infinity score entries to 0 in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [NaN, 0.5, Infinity, -Infinity] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.score).toEqual([0, 0.5, 0, 0]);
  });

  it('sets score to undefined in structuredContent when upstream score is not an array', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: 'not_array' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('score');
    expect(r.structuredContent.answers.q1.score).toBeUndefined();
  });

  it('sets score to undefined in structuredContent when upstream score is empty array', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('score');
    expect(r.structuredContent.answers.q1.score).toBeUndefined();
  });

  it('sets score to undefined when score field is missing', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('score');
    expect(r.structuredContent.answers.q1.score).toBeUndefined();
  });

  it('strips extra upstream properties from score answers in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.4, 0.6], evil: 'payload' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(Object.keys(r.structuredContent.answers.q1)).toEqual(
      expect.arrayContaining(['type', 'score']),
    );
    expect(Object.keys(r.structuredContent.answers.q1)).toHaveLength(2);
    expect((r.structuredContent.answers.q1 as Record<string, unknown>)['evil']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. decide — unknown answer type in structuredContent
// ---------------------------------------------------------------------------

describe('handleDecide — unknown answer type sanitization in structuredContent', () => {
  it('includes only type field for unknown answer types in structuredContent', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'exotic', value: 42, nested: { deep: true } },
        q2: { type: 'noul', noul: 0.7 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // Unknown type: only { type } should be present — extra fields stripped
    const q1Answer = r.structuredContent.answers.q1 as Record<string, unknown>;
    expect(q1Answer.type).toBe('exotic');
    expect(Object.keys(q1Answer)).toEqual(['type']);
    expect(q1Answer['value']).toBeUndefined();
    expect(q1Answer['nested']).toBeUndefined();

    // Known type preserved normally
    expect(r.structuredContent.answers.q2.noul).toBe(0.7);
  });
});

// ---------------------------------------------------------------------------
// 9–10. decide — choice sanitization in structuredContent
// ---------------------------------------------------------------------------

describe('handleDecide — choice sanitization in structuredContent', () => {
  it('filters non-numeric values from choice map in structuredContent', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: 'string', b: 0.8, c: NaN, d: null, e: 0.2 } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // Only finite numbers remain
    expect(r.structuredContent.answers.q1.choice).toEqual({ b: 0.8, e: 0.2 });
  });

  it('produces empty choice map when all values are non-numeric', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: 'bad', b: NaN, c: Infinity } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.choice).toEqual({});
  });

  it('produces empty choice map when choice is null/falsy', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: null } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.choice).toEqual({});
  });

  it('produces empty choice map when choice is not an object', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: 42 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.choice).toEqual({});
  });

  it('strips extra upstream properties from choice answers in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: { a: 0.5, b: 0.5 }, extra: 'danger' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(Object.keys(r.structuredContent.answers.q1)).toEqual(
      expect.arrayContaining(['type', 'choice']),
    );
    expect(Object.keys(r.structuredContent.answers.q1)).toHaveLength(2);
    expect((r.structuredContent.answers.q1 as Record<string, unknown>)['extra']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 11–12. decide — answers is null or number in response
// ---------------------------------------------------------------------------

describe('handleDecide — answers null and number in response', () => {
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

  it('returns INTERNAL when answers is a boolean', async () => {
    const client = mockDecideClient({ answers: true });
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
// 13–15. embed_text — response.data is non-array type
// ---------------------------------------------------------------------------

describe('handleEmbedText — data field is non-array type', () => {
  it('returns INTERNAL when data is a string', async () => {
    const client = mockEmbedClient({ data: 'not_an_array', model: 'test/m' });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  it('returns INTERNAL when data is a boolean', async () => {
    const client = mockEmbedClient({ data: true });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  it('returns INTERNAL when data is a number', async () => {
    const client = mockEmbedClient({ data: 42 });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });
});

// ---------------------------------------------------------------------------
// 16. embed_text — first_element_keys detail for malformed but present element
// ---------------------------------------------------------------------------

describe('handleEmbedText — first_element_keys detail for malformed elements', () => {
  it('reports correct first_element_keys for object missing embedding field', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, foo: 'bar', baz: 42 }],
      model: 'test/m',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r._meta.details).toBeDefined();
    expect(r._meta.details!.first_element_keys).toEqual(
      expect.arrayContaining(['index', 'foo', 'baz']),
    );
  });

  it('reports first_element_keys when embedding is wrong type (object)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: { nested: true } }],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
    expect(r._meta.details!.first_element_keys).toContain('embedding');
  });

  it('reports empty first_element_keys for undefined first element', async () => {
    const client = mockEmbedClient({
      data: [undefined],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r._meta.details!.first_element_keys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Combined: end-to-end sanitization of multi-type response
// ---------------------------------------------------------------------------

describe('handleDecide — comprehensive structuredContent sanitization', () => {
  it('sanitizes all answer types simultaneously in a multi-question response', async () => {
    const unsafeChoice = Object.create(null);
    unsafeChoice['__proto__'] = 0.9;
    unsafeChoice['valid'] = 0.05;
    unsafeChoice['other'] = 0.05;

    const client = mockDecideClient({
      answers: {
        noul_q: { type: 'noul', noul: NaN, extra: 'bad' },
        choice_q: { type: 'choice', choice: unsafeChoice, extra: 'bad' },
        score_q: { type: 'score', score: ['x', 0.4, null, 0.6], extra: 'bad' },
        unknown_q: { type: 'future_type', data: [1, 2, 3] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          noul_q: noulQuestion(),
          choice_q: choiceQuestion(),
          score_q: scoreQuestion(),
          unknown_q: noulQuestion('Future question'),
        },
      }),
      client,
    )) as DecideSuccessResult;

    const answers = r.structuredContent.answers;

    // noul: NaN → undefined, extra field stripped
    expect(answers.noul_q).toEqual({ type: 'noul', noul: undefined });

    // choice: __proto__ stripped, extra field stripped
    expect(answers.choice_q).toEqual({
      type: 'choice',
      choice: { valid: 0.05, other: 0.05 },
    });

    // score: non-numeric mapped to 0, extra field stripped
    expect(answers.score_q).toEqual({
      type: 'score',
      score: [0, 0.4, 0, 0.6],
    });

    // unknown: only type field
    expect(answers.unknown_q).toEqual({ type: 'future_type' });
  });
});
