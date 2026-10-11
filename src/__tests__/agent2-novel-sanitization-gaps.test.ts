/**
 * Novel sanitization and edge-case gaps for embed_text and decide handlers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Confirmed untested paths (verified via exhaustive grep across all 112+ test files):
 *
 * embed_text:
 *  1. response.model is explicitly null (vs missing/undefined) → safeResponseModel = undefined
 *  2. response.usage is an array → sanitizeUpstreamUsage returns undefined → _meta.usage omitted
 *  3. response.usage is a string → sanitizeUpstreamUsage returns undefined → _meta.usage omitted
 *  4. Batch where non-first element has embedding: undefined → rawEmbedding = [] → safeEmbedding = []
 *  5. Batch where non-first element has embedding: {} (object, not array) → rawEmbedding = []
 *  6. Embedding vector containing mixed types (null, undefined, string, boolean, object) → all → 0
 *  7. response.model is a non-empty object → typeof !== 'string' → safeResponseModel = undefined
 *
 * decide:
 *  8. choice answer where answer.choice is an array [0.5, 0.3] → enters object branch,
 *     produces numeric string keys "0", "1" in safeChoice
 *  9. response.usage is an array → sanitizeUpstreamUsage returns undefined → _meta.usage omitted
 * 10. choice answer where answer.choice is an empty object {} → safeChoice = {}
 * 11. score answer where score contains -Infinity values → typeof number but not finite → 0
 * 12. state is a Date object → typeof 'object', not null, not array → passes type check,
 *     serializable, but hasDeepUnsafeKey walks it (Object.keys returns [])
 * 13. Multiple mixed unknown + valid answer types in single response
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

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
// 1. embed_text — response.model is explicitly null
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response.model explicitly null', () => {
  it('falls back to effectiveModel when response.model is null', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: null,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    // typeof null !== 'string' → safeResponseModel = undefined → displayModel = effectiveModel
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
    expect(r._meta.model).toBe('openai/text-embedding-3-small');
    expect(r.content[0].text).toContain('openai/text-embedding-3-small');
  });

  it('falls back to user-provided model when response.model is null', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: null,
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'test', model: 'voyage/voyage-3' }),
      client,
    )) as EmbedSuccess;
    // Null response model → falls back to trimmed user model
    expect(r.structuredContent.model).toBe('voyage/voyage-3');
    expect(r._meta.model).toBe('voyage/voyage-3');
  });

  it('falls back when response.model is a non-empty object', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: { name: 'some-model' },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    // typeof {} === 'object' which is not 'string' → safeResponseModel = undefined
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2–3. embed_text — response.usage as array or string
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response.usage non-object types', () => {
  it('omits _meta.usage when response.usage is an array', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
      usage: [10, 20, 30],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    // sanitizeUpstreamUsage returns undefined for arrays (Array.isArray check)
    expect(r._meta.usage).toBeUndefined();
  });

  it('omits _meta.usage when response.usage is a string', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
      usage: 'some usage string',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    // sanitizeUpstreamUsage returns undefined for non-objects
    expect(r._meta.usage).toBeUndefined();
  });

  it('omits _meta.usage when response.usage is a number', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
      usage: 42,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r._meta.usage).toBeUndefined();
  });

  it('omits _meta.usage when response.usage is false', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
      usage: false,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r._meta.usage).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4–5. embed_text — batch with malformed embedding on non-first element
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — non-first element malformed embedding', () => {
  it('produces empty embedding when second element has embedding: undefined', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }, { index: 1 }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello', 'world'] }),
      client,
    )) as EmbedSuccess;
    // First element valid — passes the shape check
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0.2, 0.3]);
    // Second element: embedding is undefined → Array.isArray(undefined) = false → rawEmbedding = []
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });

  it('produces empty embedding when second element has embedding as plain object', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.5] },
        { index: 1, embedding: { '0': 0.3, '1': 0.7 } },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;
    // First element valid
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.5]);
    // Second element: embedding is an object (not array) → rawEmbedding = []
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });

  it('produces empty embedding when second element has embedding as number', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: 42 },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['x', 'y'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. embed_text — embedding vector with mixed invalid types
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — embedding vector mixed type sanitization', () => {
  it('maps null, undefined, string, boolean, and object values to 0', async () => {
    const client = mockEmbedClient({
      data: [
        {
          index: 0,
          embedding: [0.5, null, undefined, 'text', true, { nested: 1 }, 0.9, false, [], -0.3],
        },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    // Valid finite numbers preserved, everything else → 0
    expect(r.structuredContent.embeddings[0].embedding).toEqual([
      0.5,
      0, // null
      0, // undefined
      0, // 'text'
      0, // true
      0, // {nested: 1}
      0.9,
      0, // false
      0, // [] (not a number)
      -0.3,
    ]);
    // Dimensions should reflect the raw embedding length from first element
    expect(r.structuredContent.dimensions).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. decide — choice answer where choice is an array
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice answer where answer.choice is an array', () => {
  it('produces numeric string keys when choice is an array of numbers', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: [0.5, 0.3, 0.2] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    // Arrays are typeof 'object' and truthy → enters the sanitization loop
    // Object.entries([0.5, 0.3, 0.2]) → [["0", 0.5], ["1", 0.3], ["2", 0.2]]
    // All values are finite numbers → included in safeChoice
    const choice = r.structuredContent.answers.q1?.choice;
    expect(choice).toBeDefined();
    expect(choice!['0']).toBe(0.5);
    expect(choice!['1']).toBe(0.3);
    expect(choice!['2']).toBe(0.2);
  });

  it('filters non-finite values from array choice', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: [NaN, 0.7, Infinity] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    const choice = r.structuredContent.answers.q1?.choice;
    // NaN and Infinity are not finite → excluded
    expect(choice).toEqual({ '1': 0.7 });
  });

  it('produces correct summary line when choice is an array', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: [0.1, 0.8, 0.1] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    // In summary: entries are sorted by value desc → "1" (0.8) wins
    expect(r.content[0].text).toContain('1');
    expect(r.content[0].text).toContain('80.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. decide — response.usage non-object types
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — response.usage non-object types', () => {
  it('omits _meta.usage when response.usage is an array', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
      usage: [1, 2, 3],
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r._meta.usage).toBeUndefined();
  });

  it('omits _meta.usage when response.usage is a string', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
      usage: 'usage info',
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r._meta.usage).toBeUndefined();
  });

  it('omits _meta.usage when response.usage is a number', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
      usage: 99,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r._meta.usage).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. decide — choice answer with empty object
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice answer with empty choice object', () => {
  it('produces empty safeChoice and shows ? in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: {} },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    // Empty object → no entries → safeChoice = {}
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
    // In summary: entries.sort gives [], best is undefined → "?" with 0.0%
    expect(r.content[0].text).toContain('?');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. decide — score answer with -Infinity values
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score answer with -Infinity values', () => {
  it('maps -Infinity to 0 in structuredContent score array', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [-Infinity, 0.5, -Infinity] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    // -Infinity: typeof 'number' but NOT Number.isFinite → mapped to 0
    expect(r.structuredContent.answers.q1?.score).toEqual([0, 0.5, 0]);
  });

  it('shows correct summary for score with -Infinity values', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [-Infinity, 0.3, -Infinity, 0.7] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    // In summary loop: -Infinity passes typeof check but the comparison
    // answer.score[i]! > maxVal is false for -Infinity (except vs -Infinity).
    // 0.3 > -Infinity → maxVal = 0.3, maxIdx = 1
    // 0.7 > 0.3 → maxVal = 0.7, maxIdx = 3
    expect(r.content[0].text).toContain('level 4/4');
    expect(r.content[0].text).toContain('70.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. decide — state as Date object
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — state as Date object', () => {
  it('accepts Date object as state (typeof object, serializable, no unsafe keys)', async () => {
    const state = { timestamp: new Date('2024-01-15T12:00:00Z') };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as DecideSuccess;
    // Date object has no own keys → hasDeepUnsafeKey returns null → passes
    // JSON.stringify serializes Date → string → within size limits → passes
    expect(r.structuredContent.answers).toBeDefined();
    expect(r.content[0].text).toContain('YES');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. decide — multiple mixed unknown + valid answer types
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — complex multi-type response with unknowns', () => {
  it('correctly handles mix of valid, unknown, and malformed answer types', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.9 },
        q2: { type: 'novel_type_a', data: 'stripped' },
        q3: { type: 'choice', choice: { a: 0.6, b: 0.4 } },
        q4: { type: 'novel_type_b', nested: { deep: true } },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: choiceQuestion(),
          q3: choiceQuestion(),
          q4: scoreQuestion(),
        },
      }),
      client,
    )) as DecideSuccess;

    const answers = r.structuredContent.answers;

    // q1: valid noul
    expect(answers.q1.type).toBe('noul');
    expect(answers.q1.noul).toBe(0.9);

    // q2: unknown type → only type field preserved
    expect(answers.q2.type).toBe('novel_type_a');
    expect((answers.q2 as Record<string, unknown>).data).toBeUndefined();

    // q3: valid choice
    expect(answers.q3.type).toBe('choice');
    expect(answers.q3.choice).toEqual({ a: 0.6, b: 0.4 });

    // q4: unknown type → only type field preserved
    expect(answers.q4.type).toBe('novel_type_b');
    expect((answers.q4 as Record<string, unknown>).nested).toBeUndefined();

    // Summary should contain q1 and q3 lines (known types), skip q2 and q4 (unknown)
    const lines = r.content[0].text.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    expect(r.content[0].text).toContain('q1');
    expect(r.content[0].text).toContain('q3');
  });
});
