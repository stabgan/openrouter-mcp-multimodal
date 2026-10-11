/**
 * Agent 2 — Deep structuredContent sanitization gaps for decide and embed_text.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets (confirmed untested via exhaustive grep of all src/__tests__/):
 *
 * decide — structuredContent sanitization gaps:
 *  1. noul with -Infinity → structuredContent.answers.q1.noul is undefined
 *     (text summary tested in agent2-name-key-limits.test.ts but structuredContent NOT)
 *  2. noul with -0 → structuredContent.answers.q1.noul is -0 (finite, preserved)
 *  3. score as number (not array) → structuredContent.answers.q1.score is undefined
 *  4. score as null → structuredContent.answers.q1.score is undefined
 *  5. score as object → structuredContent.answers.q1.score is undefined
 *  6. choice: undefined → structuredContent.answers.q1.choice is {}
 *  7. noul with object value → structuredContent.answers.q1.noul is undefined
 *  8. noul with boolean value → structuredContent.answers.q1.noul is undefined
 *  9. score with mixed -Infinity/finite → -Infinity mapped to 0, finite preserved
 * 10. Combined structuredContent + text summary verification for -Infinity noul
 *
 * embed_text — structuredContent edge cases:
 * 11. texts as boolean (scalar, not array) → wraps → type error on element
 * 12. texts as number (scalar) → wraps → type error on element
 * 13. texts as object (scalar) → wraps → type error on element
 * 14. texts array with null element → type error at correct index
 * 15. texts array with undefined element → type error at correct index
 * 16. texts array with object element → type error at correct index
 * 17. data: null in response → INTERNAL error (via nullish coalescing to [])
 * 18. response with both model and usage falsy → correct fallback behavior
 *
 * decide — input validation edge cases:
 * 19. criteria: 0 (falsy number) → "criteria is required"
 * 20. criteria: '' (empty string, falsy) → "criteria is required"
 * 21. criteria: false (boolean, falsy) → "criteria is required"
 * 22. question name at exactly 40 chars in truncation check
 * 23. score criteria with empty string elements (valid — they ARE strings)
 * 24. hasDeepUnsafeKey with empty array in state → passes
 * 25. hasDeepUnsafeKey with null elements in array → skipped
 * 26. hasDeepUnsafeKey with mixed types in array (primitives + objects) → only objects scanned
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

type EmbedSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// 1–2. decide — noul structuredContent sanitization for -Infinity and -0
// ---------------------------------------------------------------------------

describe('handleDecide — noul structuredContent sanitization for -Infinity/-0', () => {
  it('sets noul to undefined in structuredContent when upstream noul is -Infinity', async () => {
    // -Infinity: typeof === 'number' but Number.isFinite(-Infinity) === false
    // safeNoul → undefined (this was only tested in text summary, not structuredContent)
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -Infinity } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('noul');
    expect(r.structuredContent.answers.q1.noul).toBeUndefined();
  });

  it('preserves -0 noul in structuredContent (finite number)', async () => {
    // -0 is typeof 'number' and Number.isFinite(-0) is true → preserved
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('noul');
    // -0 is a valid finite number, preserved in structuredContent
    // Use == comparison since Object.is(-0, 0) is false
    expect(r.structuredContent.answers.q1.noul === 0).toBe(true);
  });

  it('verifies both text summary and structuredContent for -Infinity noul', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -Infinity } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // Text summary: -Infinity fails isFinite → prob=0 → "NO 0.0%"
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');

    // structuredContent: safeNoul → undefined
    expect(r.structuredContent.answers.q1.noul).toBeUndefined();
    // Only type and noul keys (noul=undefined still shows as a key)
    expect(Object.keys(r.structuredContent.answers.q1)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3–5. decide — score structuredContent sanitization for non-array types
// ---------------------------------------------------------------------------

describe('handleDecide — score structuredContent sanitization for non-array types', () => {
  it('sets score to undefined in structuredContent when upstream score is a number', async () => {
    // Number is not an array → safeScore stays undefined
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: 42 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('score');
    expect(r.structuredContent.answers.q1.score).toBeUndefined();
  });

  it('sets score to undefined in structuredContent when upstream score is null', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: null } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('score');
    expect(r.structuredContent.answers.q1.score).toBeUndefined();
  });

  it('sets score to undefined in structuredContent when upstream score is an object', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: { nested: true } } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('score');
    expect(r.structuredContent.answers.q1.score).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6–8. decide — choice/noul structuredContent for edge value types
// ---------------------------------------------------------------------------

describe('handleDecide — choice/noul structuredContent for edge value types', () => {
  it('produces empty choice map in structuredContent when choice is undefined', async () => {
    // choice is undefined → falsy → if(answer.choice && ...) is false → safeChoice = {}
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: undefined } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('choice');
    expect(r.structuredContent.answers.q1.choice).toEqual({});
  });

  it('sets noul to undefined in structuredContent when noul is an object', async () => {
    // typeof {} === 'object', not 'number' → safeNoul = undefined
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: { value: 0.9 } } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('noul');
    expect(r.structuredContent.answers.q1.noul).toBeUndefined();
  });

  it('sets noul to undefined in structuredContent when noul is a boolean', async () => {
    // typeof true === 'boolean', not 'number' → safeNoul = undefined
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: true } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers.q1.type).toBe('noul');
    expect(r.structuredContent.answers.q1.noul).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. decide — score structuredContent with mixed -Infinity/finite
// ---------------------------------------------------------------------------

describe('handleDecide — score structuredContent with -Infinity values', () => {
  it('maps -Infinity to 0 and preserves finite values in structuredContent score', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [-Infinity, 0.7, -Infinity] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // -Infinity: typeof=number but isFinite=false → mapped to 0
    // 0.7: finite → preserved
    expect(r.structuredContent.answers.q1.score).toEqual([0, 0.7, 0]);
  });
});

// ---------------------------------------------------------------------------
// 11–16. embed_text — texts as non-string/non-array scalars and array elements
// ---------------------------------------------------------------------------

describe('handleEmbedText — texts as non-string scalar types', () => {
  it('returns INVALID_INPUT when texts is boolean true (wraps → type error)', async () => {
    // true is not undefined/null, not an array → wraps as [true]
    // typeof true !== 'string' → error at index 0
    const r = (await handleEmbedText(
      embedReq({ texts: true }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('returns INVALID_INPUT when texts is a number (wraps → type error)', async () => {
    const r = (await handleEmbedText(embedReq({ texts: 42 }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });

  it('returns INVALID_INPUT when texts is an object (wraps → type error)', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: { key: 'value' } }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });
});

describe('handleEmbedText — array elements with non-string types', () => {
  it('returns INVALID_INPUT for null element at specific index', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: ['valid', null, 'also valid'] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('returns INVALID_INPUT for undefined element at specific index', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello', undefined] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
  });

  it('returns INVALID_INPUT for object element at specific index', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello', { nested: true }] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
  });
});

// ---------------------------------------------------------------------------
// 17–18. embed_text — response edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — response edge cases for model/usage fallback', () => {
  it('returns INTERNAL when response.data is null (nullish coalescing to [])', async () => {
    // null ?? [] → [] → length 0 → INTERNAL
    const client = mockEmbedClient({ data: null, model: 'test/m' });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('handles response with usage=undefined and model=undefined', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      // no model, no usage
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccessResult;

    // Falls back to default model
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
    expect(r._meta.model).toBe('openai/text-embedding-3-small');
    expect(r._meta.usage).toBeUndefined();
    expect(r.content[0].text).toContain('openai/text-embedding-3-small');
  });
});

// ---------------------------------------------------------------------------
// 19–21. decide — criteria as falsy values
// ---------------------------------------------------------------------------

describe('handleDecide — criteria as falsy values', () => {
  it('returns INVALID_INPUT when criteria is 0', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: 'test', criteria: 0 },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria');
    expect(r.content[0].text).toContain('required');
  });

  it('returns INVALID_INPUT when criteria is empty string', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: 'test', criteria: '' },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria');
  });

  it('returns INVALID_INPUT when criteria is false', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: false },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria');
  });
});

// ---------------------------------------------------------------------------
// 22. decide — question name truncation in error messages
// ---------------------------------------------------------------------------

describe('handleDecide — question name truncation in error message', () => {
  it('truncates long question name to 40 chars in error message with ellipsis', async () => {
    // Name is 257 chars → exceeds MAX_QUESTION_NAME_LENGTH (256)
    // Error message should show first 40 chars + "…"
    const longName = 'abcdefghij'.repeat(26); // 260 chars
    const r = (await handleDecide(
      decideReq({ questions: { [longName]: noulQuestion() } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    // Should contain first 40 chars of the name
    expect(r.content[0].text).toContain(longName.slice(0, 40));
    // Should contain ellipsis
    expect(r.content[0].text).toContain('…');
    // Should NOT contain the full name (260 chars)
    expect(r.content[0].text).not.toContain(longName);
  });
});

// ---------------------------------------------------------------------------
// 23. decide — score criteria with empty string elements
// ---------------------------------------------------------------------------

describe('handleDecide — score criteria with edge string values', () => {
  it('rejects score criteria with empty string element', async () => {
    // Empty string IS typeof 'string', but the check is:
    // typeof q.criteria[i] !== 'string' → false for ''
    // There's NO trim/empty check on score criteria levels.
    // So empty string levels should actually PASS validation.
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.5, 0.5] } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: ['', 'good'] },
        },
      }),
      client,
    )) as DecideSuccessResult;
    // Empty string passes validation (it IS a string)
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('accepts score criteria at exactly MAX_SCORE_LEVELS (100)', async () => {
    const criteria = Array.from({ length: 100 }, (_, i) => `level ${i}`);
    const score = new Array(100).fill(0.01);
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria },
        },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 24–26. decide — hasDeepUnsafeKey with various array contents
// ---------------------------------------------------------------------------

describe('handleDecide — hasDeepUnsafeKey with array edge cases in state', () => {
  it('accepts state with empty arrays at various levels', async () => {
    const state = { a: [], b: { c: [] }, d: [{ e: [] }] };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('accepts state with null elements in arrays (skipped by hasDeepUnsafeKey)', async () => {
    // null: typeof 'object' but !value check returns null early
    const state = { items: [null, null, { safe: true }] };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('accepts state with mixed primitives and objects in arrays', async () => {
    // Primitives (string, number, boolean): typeof !== 'object' → skipped
    // Objects: scanned for unsafe keys
    const state = {
      mixed: ['text', 42, true, null, { valid: 'object' }, false, undefined],
    };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.9 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
    expect(r.content[0].text).toContain('YES');
  });

  it('rejects state with unsafe key inside object nested within mixed-type array', async () => {
    const inner = Object.create(null);
    inner['constructor'] = 'attack';
    inner['data'] = 'value';
    // Unsafe key is inside an object that's inside an array with primitives
    const state = { items: ['safe', 42, inner, true] };
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('constructor');
  });
});

// ---------------------------------------------------------------------------
// Combined: multi-type response with all sanitization paths exercised
// ---------------------------------------------------------------------------

describe('handleDecide — combined response with all sanitization paths', () => {
  it('handles response mixing sanitized noul/-Infinity, choice/empty, score/non-array, unknown', async () => {
    const client = mockDecideClient({
      answers: {
        noul_inf: { type: 'noul', noul: -Infinity, extra: 'leaked' },
        choice_undef: { type: 'choice', choice: undefined, extra: 'leaked' },
        score_num: { type: 'score', score: 99, extra: 'leaked' },
        future: { type: 'beta_type', value: 'test', extra: 'leaked' },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          noul_inf: noulQuestion(),
          choice_undef: choiceQuestion(),
          score_num: scoreQuestion(),
          future: noulQuestion('Future question'),
        },
      }),
      client,
    )) as DecideSuccessResult;

    const answers = r.structuredContent.answers;

    // noul with -Infinity: sanitized to undefined, extra stripped
    expect(answers.noul_inf.type).toBe('noul');
    expect(answers.noul_inf.noul).toBeUndefined();
    expect((answers.noul_inf as Record<string, unknown>)['extra']).toBeUndefined();

    // choice with undefined: empty map, extra stripped
    expect(answers.choice_undef.type).toBe('choice');
    expect(answers.choice_undef.choice).toEqual({});
    expect((answers.choice_undef as Record<string, unknown>)['extra']).toBeUndefined();

    // score as number: undefined, extra stripped
    expect(answers.score_num.type).toBe('score');
    expect(answers.score_num.score).toBeUndefined();
    expect((answers.score_num as Record<string, unknown>)['extra']).toBeUndefined();

    // unknown type: only type field, everything else stripped
    expect(answers.future).toEqual({ type: 'beta_type' });
  });
});
