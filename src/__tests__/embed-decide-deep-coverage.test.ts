/**
 * Deep coverage for untested branches in embed_text and decide handlers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * embed_text gaps:
 *  1. Response count capping: upstream returns MORE embeddings than texts sent
 *  2. data field is a non-array value (e.g., string or number)
 *
 * decide gaps:
 *  3. questions serialized size exceeding MAX_QUESTIONS_BYTES (1_000_000)
 *  4. questions not serializable (circular reference in questions object)
 *  5. Unsafe keys on individual question objects (unsafeQObjKey branch)
 *  6. Score response with ALL NaN values → maxVal = -Infinity → 0%
 *  7. Unknown answer type in response → default switch branch
 *  8. processedAnswers >= questionNames.length → answer count cap
 *  9. Upstream answer key exceeding MAX_QUESTION_NAME_LENGTH (256) → skipped
 * 10. Upstream answer with __proto__/constructor/prototype key → skipped
 * 11. Sanitized choice stripping unsafe keys from choice map
 * 12. hasDeepUnsafeKey scanning arrays inside state
 * 13. hasDeepUnsafeKey depth cap (depth > 32 stops scanning)
 * 14. Noul sanitization: safeNoul is undefined when noul is non-number
 * 15. Score sanitization: non-array score → safeScore is undefined
 * 16. sanitizeUpstreamUsage: duration_s key (known key not previously tested)
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { sanitizeUpstreamUsage } from '../tool-handlers/sanitize-usage.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
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

function mockEmbedClient(response: unknown) {
  const createEmbeddings = vi.fn().mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  const submitDecision = vi.fn().mockResolvedValue(response);
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

// ═══════════════════════════════════════════════════════════════════════════
// 1. embed_text — response count capping
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response count capping', () => {
  it('caps embeddings when upstream returns more than texts sent', async () => {
    // Send 2 texts but upstream returns 4 embeddings
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: [0.3, 0.4] },
        { index: 2, embedding: [0.5, 0.6] },
        { index: 3, embedding: [0.7, 0.8] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello', 'world'] }),
      client,
    )) as EmbedSuccessResult;
    // Should only return 2 embeddings, sliced to match input count
    expect(r.structuredContent.embeddings).toHaveLength(2);
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0.2]);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([0.3, 0.4]);
    expect(r.content[0].text).toContain('2 embedding(s)');
  });

  it('does not cap when upstream returns exactly the right count', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings).toHaveLength(2);
  });

  it('does not cap when upstream returns fewer than texts sent', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b', 'c'] }),
      client,
    )) as EmbedSuccessResult;
    // 1 embedding for 3 texts — no capping needed
    expect(r.structuredContent.embeddings).toHaveLength(1);
  });

  it('caps for single text input when upstream returns extra embeddings', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
        { index: 2, embedding: [0.3] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'single text' }),
      client,
    )) as EmbedSuccessResult;
    // Single text → inputArray has 1 element → cap to 1
    expect(r.structuredContent.embeddings).toHaveLength(1);
    expect(r._meta.embedding_count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. embed_text — data field is non-array
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — non-array data field', () => {
  it('returns INTERNAL when data is a string', async () => {
    const client = mockEmbedClient({ data: 'not an array', model: 'test/model' });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  it('returns INTERNAL when data is a number', async () => {
    const client = mockEmbedClient({ data: 42, model: 'test/model' });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('returns INTERNAL when data is an object (not array)', async () => {
    const client = mockEmbedClient({ data: { embedding: [0.1] }, model: 'test/model' });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('returns INTERNAL when data is null', async () => {
    const client = mockEmbedClient({ data: null, model: 'test/model' });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. decide — questions serialized size exceeding MAX_QUESTIONS_BYTES
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — questions aggregate size guard', () => {
  it('returns INVALID_INPUT when questions exceed MAX_QUESTIONS_BYTES (1_000_000)', async () => {
    // Build a questions object that serializes to > 1MB
    // Each question has long instructions and many criteria values
    const questions: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      const criteria: Record<string, string> = {};
      for (let j = 0; j < 50; j++) {
        criteria[`opt_${j}`] = 'x'.repeat(500);
      }
      questions[`q${i}`] = {
        type: 'choice',
        instructions: 'y'.repeat(500),
        criteria,
      };
    }
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('serialized size');
    expect(r.content[0].text).toContain('1000000');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. decide — questions not serializable
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — non-serializable questions', () => {
  it('returns INVALID_INPUT when questions contain circular references in extra fields', async () => {
    // The circular ref must be in a field the validator doesn't traverse.
    // Field validators check type, instructions, criteria — but extra
    // properties on the question object pass through unchecked until
    // JSON.stringify runs.
    const extra: Record<string, unknown> = { data: 'value' };
    extra.self = extra; // circular reference
    const questions = {
      q1: {
        type: 'noul',
        instructions: 'test',
        criteria: { yes: 'y', no: 'n' },
        context: extra, // extra field with circular ref
      },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('not serializable');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. decide — unsafe keys on question objects (unsafeQObjKey)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — unsafe keys on question objects', () => {
  it('rejects question object with __proto__ property', async () => {
    const q = Object.create(null);
    q.type = 'noul';
    q.instructions = 'Is it raining?';
    q.criteria = { yes: 'Yes', no: 'No' };
    q['__proto__'] = 'polluted';
    const r = (await handleDecide(
      decideReq({ questions: { q1: q } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions.q1');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('__proto__');
  });

  it('rejects question object with constructor property', async () => {
    const q = Object.create(null);
    q.type = 'choice';
    q.instructions = 'Pick one';
    q.criteria = { a: 'A', b: 'B' };
    q['constructor'] = 'polluted';
    const r = (await handleDecide(
      decideReq({ questions: { q1: q } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions.q1');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('constructor');
  });

  it('rejects question object with prototype property', async () => {
    const q = Object.create(null);
    q.type = 'score';
    q.instructions = 'Rate';
    q.criteria = ['bad', 'good'];
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

// ═══════════════════════════════════════════════════════════════════════════
// 6. decide — score response where ALL values are NaN
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score all NaN fallback', () => {
  it('displays 0% when all score values are NaN (maxVal = -Infinity)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [NaN, NaN, NaN] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // maxVal stays -Infinity → displayScore = 0 → "0.0%"
    expect(r.content[0].text).toContain('0.0%');
    expect(r.content[0].text).toContain('level 1/3');
  });

  it('displays 0% when all score values are non-numeric strings', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: ['bad', 'worse', 'worst'] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. decide — unknown answer type (default switch branch)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — unknown answer type in response', () => {
  it('includes unknown type with only the type field in structuredContent', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'novel_type', data: 'should be stripped', extra: [1, 2, 3] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Unknown type → only `type` field preserved, all others stripped
    const answer = r.structuredContent.answers.q1;
    expect(answer).toBeDefined();
    expect(answer.type).toBe('novel_type');
    // Extra properties should be stripped
    expect((answer as Record<string, unknown>).data).toBeUndefined();
    expect((answer as Record<string, unknown>).extra).toBeUndefined();
  });

  it('does not include unknown type in the text summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'unknown_type', value: 42 },
        q2: { type: 'noul', noul: 0.8 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // q1 unknown type → skipped in summary, q2 noul → appears
    expect(r.content[0].text).toContain('q2');
    expect(r.content[0].text).toContain('YES');
    // q1 is not in the summary since none of the if/else-if branches match
    expect(r.content[0].text).not.toContain('unknown_type');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. decide — processedAnswers cap
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — answer count cap', () => {
  it('caps answers processed to questionNames.length', async () => {
    // Send 2 questions but upstream returns 5 answers
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.9 },
        q2: { type: 'noul', noul: 0.1 },
        extra1: { type: 'noul', noul: 0.5 },
        extra2: { type: 'noul', noul: 0.6 },
        extra3: { type: 'noul', noul: 0.7 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Only 2 answers should be processed (matching 2 questions)
    const answerKeys = Object.keys(r.structuredContent.answers);
    expect(answerKeys.length).toBeLessThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. decide — upstream answer key exceeding MAX_QUESTION_NAME_LENGTH
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — oversized answer keys from upstream', () => {
  it('skips answer keys longer than 256 chars', async () => {
    const longKey = 'q'.repeat(257);
    const client = mockDecideClient({
      answers: {
        [longKey]: { type: 'noul', noul: 0.9 },
        q1: { type: 'noul', noul: 0.7 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Long key should be skipped, only q1 present
    expect(r.structuredContent.answers[longKey]).toBeUndefined();
    expect(r.structuredContent.answers.q1).toBeDefined();
    expect(r.content[0].text).toContain('q1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. decide — upstream answer with prototype-pollution keys
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — unsafe answer keys from upstream', () => {
  it('skips __proto__ answer key from upstream response', async () => {
    // Simulate upstream returning __proto__ as an answer key
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.9 };
    answers['q1'] = { type: 'noul', noul: 0.7 };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // __proto__ should be skipped — check own keys, not prototype chain
    expect(Object.hasOwn(r.structuredContent.answers, '__proto__')).toBe(false);
    expect(r.structuredContent.answers.q1).toBeDefined();
  });

  it('skips constructor answer key from upstream response', async () => {
    const answers = Object.create(null);
    answers['constructor'] = { type: 'noul', noul: 0.9 };
    answers['q1'] = { type: 'noul', noul: 0.3 };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // constructor should be skipped — check own keys
    expect(Object.keys(r.structuredContent.answers)).not.toContain('constructor');
    expect(r.structuredContent.answers.q1).toBeDefined();
  });

  it('skips prototype answer key from upstream response', async () => {
    const answers = Object.create(null);
    answers['prototype'] = { type: 'choice', choice: { a: 0.5, b: 0.5 } };
    answers['q1'] = { type: 'noul', noul: 0.6 };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // prototype should be skipped — check own keys
    expect(Object.keys(r.structuredContent.answers)).not.toContain('prototype');
    expect(r.structuredContent.answers.q1).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. decide — sanitized choice stripping unsafe keys
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice answer sanitization strips unsafe keys', () => {
  it('strips __proto__ from choice probability map', async () => {
    const choice = Object.create(null);
    choice['__proto__'] = 0.5;
    choice['a'] = 0.3;
    choice['b'] = 0.7;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const sanitizedChoice = r.structuredContent.answers.q1?.choice;
    expect(sanitizedChoice).toBeDefined();
    // __proto__ should be stripped from the choice map
    expect(Object.keys(sanitizedChoice!)).not.toContain('__proto__');
    expect(sanitizedChoice!.a).toBe(0.3);
    expect(sanitizedChoice!.b).toBe(0.7);
  });

  it('strips constructor from choice probability map', async () => {
    const choice = Object.create(null);
    choice['constructor'] = 0.9;
    choice['red'] = 0.1;
    choice['blue'] = 0.8;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const sanitizedChoice = r.structuredContent.answers.q1?.choice;
    expect(Object.keys(sanitizedChoice!)).not.toContain('constructor');
  });

  it('strips non-finite values from choice probability map', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: NaN, b: 0.6, c: Infinity, d: 'bad' } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const sanitizedChoice = r.structuredContent.answers.q1?.choice;
    expect(sanitizedChoice).toEqual({ b: 0.6 });
  });

  it('returns empty choice map when choice field is null', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: null } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
  });

  it('returns empty choice map when choice field is a string', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: 'not an object' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. decide — hasDeepUnsafeKey scanning arrays in state
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — deep unsafe key scanning in arrays', () => {
  it('rejects state with unsafe key inside array element', async () => {
    const inner = Object.create(null);
    inner['__proto__'] = 'attack';
    inner['data'] = 'value';
    const state = { items: [inner] };
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('rejects state with unsafe key in nested array of objects', async () => {
    const inner = Object.create(null);
    inner['constructor'] = {};
    inner['safe'] = true;
    const state = { deep: { nested: [{ ok: true }, inner] } };
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('accepts state with arrays of primitives (no unsafe keys possible)', async () => {
    const state = { numbers: [1, 2, 3], strings: ['a', 'b'], mixed: [null, true, 42] };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. decide — hasDeepUnsafeKey depth cap
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — state nesting depth cap', () => {
  it('stops scanning at depth > 32 (unsafe key at depth 33 is ignored)', async () => {
    // Build object nested 33 levels deep with __proto__ at the bottom
    let obj: Record<string, unknown> = Object.create(null);
    obj['__proto__'] = 'attack'; // at depth 33
    obj['data'] = 'leaf';
    for (let i = 0; i < 33; i++) {
      obj = { nested: obj };
    }
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    // At depth > 32, hasDeepUnsafeKey returns null without scanning
    // so this should pass validation
    const r = await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state: obj }),
      client,
    );
    // Should not error — depth cap stops scanning
    expect((r as ErrorResult).isError).toBeUndefined();
  });

  it('detects unsafe key at exactly depth 32 (within limit)', async () => {
    // Build object nested 32 levels deep with __proto__ at the bottom
    let obj: Record<string, unknown> = Object.create(null);
    obj['__proto__'] = 'attack'; // at depth 32
    obj['data'] = 'leaf';
    for (let i = 0; i < 32; i++) {
      obj = { nested: obj };
    }
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state: obj }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. decide — noul sanitization (safeNoul undefined)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — noul answer sanitization in structuredContent', () => {
  it('sets safeNoul to undefined when noul is a string', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 'high' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // String noul → not number → safeNoul = undefined
    expect(r.structuredContent.answers.q1?.noul).toBeUndefined();
  });

  it('sets safeNoul to undefined when noul is NaN', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: NaN } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.noul).toBeUndefined();
  });

  it('sets safeNoul to undefined when noul is Infinity', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: Infinity } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.noul).toBeUndefined();
  });

  it('preserves valid finite noul in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.85 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.noul).toBe(0.85);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. decide — score sanitization in structuredContent
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score answer sanitization in structuredContent', () => {
  it('sets safeScore to undefined when score is not an array', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: 'not an array' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.score).toBeUndefined();
  });

  it('sets safeScore to undefined when score is empty array', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.score).toBeUndefined();
  });

  it('replaces non-finite values with 0 in score array', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [NaN, 0.5, Infinity, 'bad'] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.score).toEqual([0, 0.5, 0, 0]);
  });

  it('preserves valid score array in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.1, 0.3, 0.4, 0.2] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.score).toEqual([0.1, 0.3, 0.4, 0.2]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. sanitizeUpstreamUsage — duration_s key
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeUpstreamUsage — duration_s key', () => {
  it('includes duration_s when present and valid', () => {
    expect(sanitizeUpstreamUsage({ duration_s: 4.5 })).toEqual({ duration_s: 4.5 });
  });

  it('includes duration_s alongside other valid keys', () => {
    const usage = { prompt_tokens: 10, duration_s: 3.2, cost: 0.01 };
    expect(sanitizeUpstreamUsage(usage)).toEqual({
      prompt_tokens: 10,
      duration_s: 3.2,
      cost: 0.01,
    });
  });

  it('drops duration_s when NaN', () => {
    expect(sanitizeUpstreamUsage({ duration_s: NaN, cost: 0.01 })).toEqual({ cost: 0.01 });
  });

  it('drops duration_s when not a number', () => {
    expect(sanitizeUpstreamUsage({ duration_s: '5 seconds' as unknown as number })).toBeUndefined();
  });

  it('includes duration_s at 0 (valid finite)', () => {
    expect(sanitizeUpstreamUsage({ duration_s: 0 })).toEqual({ duration_s: 0 });
  });
});
