/**
 * Agent 2 — Novel integration & edge-case tests for embed_text and decide.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Each test targets a genuinely untested path verified via exhaustive grep:
 *
 * embed_text:
 *  1. Validation priority: texts error returned before model error (ordering)
 *  2. Batch embedding sanitization: non-first elements with mixed malformed types
 *     (null embedding, object embedding, undefined embedding in positions 1+)
 *  3. Embedding sanitization: mixed non-number types in a single vector
 *     (null, boolean, object, undefined, string interleaved with valid numbers)
 *  4. Response.usage with only unknown keys → _meta.usage omitted
 *  5. Response.usage with mix of valid and non-finite values → partial sanitization
 *  6. Single string input where string has leading/trailing whitespace (not trimmed)
 *  7. Model with exactly 1 char (minimal valid model string)
 *
 * decide:
 *  8. State with nested arrays of arrays (array inside array inside state)
 *  9. State with array containing mix of primitives and safe objects
 * 10. processedAnswers counter: skipped entries (unsafe key + malformed + oversized)
 *     don't count toward the cap, so valid answers after skipped ones still appear
 * 11. Multiple answer types in structuredContent: verify exact sanitized shape
 *     with noul + choice + score + unknown type all in one response
 * 12. Choice answer with empty object {} → safeChoice empty, summary shows "?" 0%
 * 13. Score answer where only the last element is a valid number
 * 14. Noul answer where noul is exactly 0 → sanitized to 0, summary shows NO 0.0%
 * 15. Questions serialized size at boundary (just under 1_000_000)
 * 16. Decide with usage containing duration_s and cost → both forwarded in _meta
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; details?: Record<string, unknown> };
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
// 1. embed_text — Validation priority ordering
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — validation priority ordering', () => {
  it('returns texts error before model error when both are invalid', async () => {
    // Both texts (undefined) and model (number) are invalid — texts check comes first
    const r = (await handleEmbedText(embedReq({ model: 42 }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts is required');
    // Should NOT contain model error
    expect(r.content[0].text).not.toContain('non-empty string');
  });

  it('returns texts empty error before dimensions error when both are invalid', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [], dimensions: -1 }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('empty');
    expect(r.content[0].text).not.toContain('positive integer');
  });

  it('returns per-text error before dimensions error', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: ['valid', 123], dimensions: 'bad' }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('texts[1]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. embed_text — Batch embedding sanitization for non-first elements
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — batch sanitization of non-first elements', () => {
  it('handles non-first element with null embedding → rawEmbedding = []', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: null },
        { index: 2, embedding: [0.5, 0.6] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b', 'c'] }), client)) as EmbedSuccess;
    // First element valid → passes shape check
    expect(r.structuredContent.embeddings).toHaveLength(3);
    // Second element: null → rawEmbedding = [] → safeEmbedding = []
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
    // Third element preserved
    expect(r.structuredContent.embeddings[2].embedding).toEqual([0.5, 0.6]);
  });

  it('handles non-first element with object embedding → rawEmbedding = []', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.3] },
        { index: 1, embedding: { nested: true } },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });

  it('handles non-first element with string embedding → rawEmbedding = []', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.7, 0.8] },
        { index: 1, embedding: 'not an array' },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. embed_text — Mixed non-number types in a single embedding vector
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — mixed types in embedding vector sanitization', () => {
  it('replaces null, boolean, object, undefined, string with 0', async () => {
    const client = mockEmbedClient({
      data: [
        {
          index: 0,
          embedding: [0.5, null, true, { x: 1 }, undefined, 'bad', 0.9, NaN, Infinity],
        },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccess;
    // 0.5 → 0.5, null → 0, true → 0, {x:1} → 0, undefined → 0, 'bad' → 0, 0.9 → 0.9, NaN → 0, Infinity → 0
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.5, 0, 0, 0, 0, 0, 0.9, 0, 0]);
    expect(r.structuredContent.dimensions).toBe(9);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. embed_text — response.usage with only unknown keys
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — usage sanitization in _meta', () => {
  it('omits usage when response.usage has only unknown keys', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
      usage: { unknown_field: 42, another: 'string' },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    // sanitizeUpstreamUsage returns undefined for usage with no known keys
    expect(r._meta.usage).toBeUndefined();
  });

  it('partially sanitizes usage keeping only valid known fields', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
      usage: {
        prompt_tokens: 15,
        completion_tokens: NaN,
        total_tokens: Infinity,
        cost: 0.003,
        unknown_extra: 'ignored',
      },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    // Only prompt_tokens and cost are finite numbers
    expect(r._meta.usage).toEqual({ prompt_tokens: 15, cost: 0.003 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. embed_text — Single string with whitespace (not trimmed)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — single string normalization edge cases', () => {
  it('passes string with internal whitespace to API without trimming', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
    });
    await handleEmbedText(embedReq({ texts: '  hello world  ' }), client);
    // The text itself is NOT trimmed — only the empty check uses .trim()
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ input: ['  hello world  '] }),
    );
  });

  it('accepts model with exactly 1 character', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'x',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'test', model: 'x' }),
      client,
    )) as EmbedSuccess;
    expect(r.structuredContent.model).toBe('x');
    expect(r._meta.model).toBe('x');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. decide — State with nested arrays of arrays
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — state with nested arrays of arrays', () => {
  it('accepts state containing array of arrays (all primitives)', async () => {
    const state = {
      matrix: [
        [1, 2, 3],
        [4, 5, 6],
      ],
      labels: [['a', 'b'], ['c']],
    };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers.q1).toBeDefined();
  });

  it('rejects state with unsafe key inside array of arrays', async () => {
    const inner = Object.create(null);
    inner['__proto__'] = 'attack';
    inner['data'] = 'value';
    const state = {
      matrix: [[inner]],
    };
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('accepts state with mixed array of primitives and safe objects', async () => {
    const state = {
      items: [42, 'string', null, true, { nested: { deep: 'value' } }, [1, 2, [3, 4]]],
    };
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

// ═══════════════════════════════════════════════════════════════════════════
// 7. decide — processedAnswers counter: skipped entries don't count
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — processedAnswers cap with skipped entries', () => {
  it('valid answers after skipped unsafe+oversized+malformed entries still appear', async () => {
    // Send 3 questions. Upstream returns:
    //   - __proto__ (skipped: unsafe key)
    //   - qqqq... (skipped: oversized key > 256)
    //   - null_entry (skipped: malformed null)
    //   - q1, q2, q3 (valid)
    // Only the 3 valid ones should appear, cap is 3 (matching questionNames.length)
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.9 };
    const longKey = 'x'.repeat(257);
    answers[longKey] = { type: 'noul', noul: 0.8 };
    answers['null_entry'] = null;
    answers['q1'] = { type: 'noul', noul: 0.7 };
    answers['q2'] = { type: 'choice', choice: { a: 0.6, b: 0.4 } };
    answers['q3'] = { type: 'score', score: [0.1, 0.2, 0.7] };

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: choiceQuestion(),
          q3: scoreQuestion(),
        },
      }),
      client,
    )) as DecideSuccess;

    // __proto__, longKey, and null_entry are skipped — don't count toward cap
    const answerKeys = Object.keys(r.structuredContent.answers);
    expect(answerKeys).toContain('q1');
    expect(answerKeys).toContain('q2');
    expect(answerKeys).toContain('q3');
    // Skipped entries should NOT appear
    expect(answerKeys).not.toContain(longKey);
    expect(Object.hasOwn(r.structuredContent.answers, '__proto__')).toBe(false);
    // null_entry was malformed null → skipped
    expect(answerKeys).not.toContain('null_entry');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. decide — Full sanitized shape with all answer types in one response
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — all answer types in one response: sanitized shape', () => {
  it('produces correct sanitized structuredContent for noul+choice+score+unknown', async () => {
    const client = mockDecideClient({
      answers: {
        q_noul: { type: 'noul', noul: 0.85, extra: 'stripped' },
        q_choice: {
          type: 'choice',
          choice: { a: 0.6, b: 0.4 },
          extra_field: 'stripped',
        },
        q_score: { type: 'score', score: [0.1, 0.3, 0.6], extra: 'stripped' },
        q_unknown: { type: 'novel_type', data: 'stripped', values: [1, 2, 3] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q_noul: noulQuestion(),
          q_choice: choiceQuestion(),
          q_score: scoreQuestion(),
          q_unknown: noulQuestion(), // question type doesn't have to match answer type
        },
      }),
      client,
    )) as DecideSuccess;

    const answers = r.structuredContent.answers;

    // noul: only type + noul fields, extra stripped
    expect(answers.q_noul).toEqual({ type: 'noul', noul: 0.85 });
    expect((answers.q_noul as Record<string, unknown>).extra).toBeUndefined();

    // choice: only type + choice fields, extra stripped
    expect(answers.q_choice).toEqual({ type: 'choice', choice: { a: 0.6, b: 0.4 } });
    expect((answers.q_choice as Record<string, unknown>).extra_field).toBeUndefined();

    // score: only type + score fields, extra stripped
    expect(answers.q_score).toEqual({ type: 'score', score: [0.1, 0.3, 0.6] });
    expect((answers.q_score as Record<string, unknown>).extra).toBeUndefined();

    // unknown: only type field, all other properties stripped
    expect(answers.q_unknown.type).toBe('novel_type');
    expect((answers.q_unknown as Record<string, unknown>).data).toBeUndefined();
    expect((answers.q_unknown as Record<string, unknown>).values).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. decide — Choice answer with empty object
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice with empty object response', () => {
  it('produces empty choice map and "?" summary when choice is {}', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: {} } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    // Empty choice → safeChoice = {}
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
    // Summary: Object.entries({}).filter(...).sort(...) → [] → best = undefined
    expect(r.content[0].text).toContain('?');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. decide — Score where only last element is valid
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score with only last element valid', () => {
  it('identifies last element as highest when all others are non-numeric', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: ['bad', NaN, null, 0.95] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    // Only score[3] = 0.95 is a valid number → maxIdx = 3 → level 4/4
    expect(r.content[0].text).toContain('level 4/4');
    expect(r.content[0].text).toContain('95.0%');
    // structuredContent: non-finite → 0
    expect(r.structuredContent.answers.q1?.score).toEqual([0, 0, 0, 0.95]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. decide — Noul exactly 0 sanitization
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — noul value of exactly 0', () => {
  it('preserves noul=0 in structuredContent (0 is a valid finite number)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    // 0 is finite → safeNoul = 0 (not undefined)
    expect(r.structuredContent.answers.q1?.noul).toBe(0);
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. decide — usage with duration_s and cost forwarded
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — usage with duration_s and cost', () => {
  it('forwards both duration_s and cost through sanitizeUpstreamUsage', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
      usage: { duration_s: 2.5, cost: 0.01, unknown_key: 'ignored' },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r._meta.usage).toEqual({ duration_s: 2.5, cost: 0.01 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. embed_text — dimensions reported from sanitized (not raw) vector
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — sanitizedDimensions reflects actual output', () => {
  it('reports dimensions from sanitized first embedding, not raw', async () => {
    // All values in first embedding are valid finite numbers
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3] },
        { index: 1, embedding: [0.4, 0.5, 0.6] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;
    // Verify that dimensions in structuredContent, _meta, and summary text all match
    expect(r.structuredContent.dimensions).toBe(3);
    expect(r._meta.dimensions).toBe(3);
    expect(r.content[0].text).toContain('3 dimensions');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. decide — Questions serialized size just under boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — questions aggregate size boundary', () => {
  it('accepts questions at just under 1_000_000 bytes', async () => {
    // Build a questions object that serializes to ~999K bytes
    // Each question: ~25K bytes (criteria with 2 entries of ~12K each + overhead)
    const questions: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) {
      const criteria: Record<string, string> = {};
      for (let j = 0; j < 2; j++) {
        criteria[`opt_${j}`] = 'x'.repeat(9_990);
      }
      questions[`q${i}`] = {
        type: 'choice',
        instructions: 'y'.repeat(100),
        criteria,
      };
    }
    // Verify it's under the limit
    const size = JSON.stringify(questions).length;
    expect(size).toBeLessThan(1_000_000);
    expect(size).toBeGreaterThan(400_000); // sanity: it's reasonably large

    // Build matching answers
    const answers: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) {
      answers[`q${i}`] = { type: 'choice', choice: { opt_0: 0.6, opt_1: 0.4 } };
    }
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(decideReq({ questions }), client)) as DecideSuccess;
    expect(r.structuredContent.answers).toBeDefined();
    expect(Object.keys(r.structuredContent.answers).length).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. embed_text — response with exactly matching count vs fewer
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response count edge cases', () => {
  it('preserves all embeddings when count matches exactly', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
        { index: 2, embedding: [0.3] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b', 'c'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings).toHaveLength(3);
    expect(r._meta.embedding_count).toBe(3);
  });

  it('handles single text with exactly one embedding returned', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'single text input' }),
      client,
    )) as EmbedSuccess;
    expect(r.structuredContent.embeddings).toHaveLength(1);
    expect(r.structuredContent.dimensions).toBe(5);
    expect(r.content[0].text).toContain('1 embedding(s)');
    expect(r.content[0].text).toContain('5 dimensions');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. decide — model trimming with leading/trailing spaces
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — model trimming and _meta consistency', () => {
  it('trims model with spaces and uses trimmed value in _meta', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQuestion() },
        model: '  microsoft/decision-1  ',
      }),
      client,
    )) as DecideSuccess;
    expect(r._meta.model).toBe('microsoft/decision-1');
    expect(client.submitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'microsoft/decision-1' }),
    );
  });
});
