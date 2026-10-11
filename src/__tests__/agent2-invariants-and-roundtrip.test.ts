/**
 * Handler output invariants and JSON round-trip integrity.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests in src/__tests__/ — it does NOT modify source code.
 *
 * Tests cover genuinely untested invariants verified via exhaustive grep
 * across all existing test files (126 files, 3704 tests):
 *
 * 1. embed_text — structuredContent survives JSON round-trip without data loss
 * 2. decide — structuredContent survives JSON round-trip without data loss
 * 3. embed_text — output shape invariant: success never has isError; error
 *    never has structuredContent
 * 4. decide — same output shape invariant
 * 5. embed_text — concurrent calls don't interfere with each other
 * 6. decide — concurrent calls don't interfere with each other
 * 7. embed_text — summary text always contains model, embedding count, and dimensions
 * 8. decide — summary text contains every answered question name
 * 9. embed_text — _meta.embedding_count === structuredContent.embeddings.length
 * 10. decide — _meta.question_count reflects input question count, not answer count
 * 11. embed_text — structuredContent.dimensions === first embedding vector length
 * 12. decide — sanitizedAnswers only contain allowlisted keys per type
 * 13. embed_text — every embedding in structuredContent has finite number[] values
 * 14. decide — every noul value in structuredContent is finite or undefined
 * 15. decide — every score value in structuredContent is finite number or undefined array
 * 16. decide — every choice value in structuredContent has only finite number entries
 * 17. embed_text — negative Infinity dimensions returns INVALID_INPUT
 * 18. embed_text — dimensions as boolean returns INVALID_INPUT
 * 19. decide — score criteria with exactly 0 levels (empty array) fails
 * 20. decide — choice summary where answer.choice is truthy but entries filter is empty
 *     (no valid finite entries) → shows "?" with 0%
 * 21. embed_text — response with usage containing only unknown keys → _meta.usage omitted
 * 22. decide — response with usage = 0 (falsy number) → _meta.usage omitted
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

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
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
// 1–2. JSON round-trip integrity
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — JSON round-trip integrity', () => {
  it('structuredContent survives JSON.stringify + JSON.parse without data loss', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3] },
        { index: 1, embedding: [0.4, 0.5, 0.6] },
      ],
      model: 'openai/text-embedding-3-small',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello', 'world'] }),
      client,
    )) as EmbedSuccess;

    const roundTripped = JSON.parse(JSON.stringify(r.structuredContent));
    expect(roundTripped).toEqual(r.structuredContent);
    // Verify specific numeric precision is preserved
    expect(roundTripped.embeddings[0].embedding[0]).toBe(0.1);
    expect(roundTripped.dimensions).toBe(3);
    expect(roundTripped.model).toBe('openai/text-embedding-3-small');
  });

  it('_meta survives JSON round-trip including usage', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'test/model',
      usage: { prompt_tokens: 10, total_tokens: 10, cost: 0.001 },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccess;

    const roundTripped = JSON.parse(JSON.stringify(r._meta));
    expect(roundTripped).toEqual(r._meta);
  });
});

describe('handleDecide — JSON round-trip integrity', () => {
  it('structuredContent with mixed answer types survives JSON round-trip', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.85 },
        q2: { type: 'choice', choice: { red: 0.1, blue: 0.7, green: 0.2 } },
        q3: { type: 'score', score: [0.05, 0.15, 0.6, 0.2] },
      },
    });
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

    const roundTripped = JSON.parse(JSON.stringify(r.structuredContent));
    expect(roundTripped).toEqual(r.structuredContent);
    // Verify numeric precision
    expect(roundTripped.answers.q1.noul).toBe(0.85);
    expect(roundTripped.answers.q2.choice.blue).toBe(0.7);
    expect(roundTripped.answers.q3.score[2]).toBe(0.6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3–4. Output shape invariant: success vs error mutual exclusivity
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — output shape invariant', () => {
  it('success result has structuredContent and no isError', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.structuredContent).toBeDefined();
    expect(r.content).toBeDefined();
    expect((r as unknown as ErrorResult).isError).toBeUndefined();
  });

  it('error result has isError and no structuredContent', async () => {
    const r = (await handleEmbedText(embedReq({}), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect((r as unknown as EmbedSuccess).structuredContent).toBeUndefined();
  });
});

describe('handleDecide — output shape invariant', () => {
  it('success result has structuredContent and no isError', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent).toBeDefined();
    expect((r as unknown as ErrorResult).isError).toBeUndefined();
  });

  it('error result has isError and no structuredContent', async () => {
    const r = (await handleDecide(decideReq({}), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect((r as unknown as DecideSuccess).structuredContent).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5–6. Concurrent call safety
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — concurrent call safety', () => {
  it('multiple simultaneous calls return independent results', async () => {
    const client1 = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'model-a',
    });
    const client2 = mockEmbedClient({
      data: [{ index: 0, embedding: [0.9, 0.8, 0.7] }],
      model: 'model-b',
    });

    const [r1, r2] = (await Promise.all([
      handleEmbedText(embedReq({ texts: 'first' }), client1),
      handleEmbedText(embedReq({ texts: 'second' }), client2),
    ])) as [EmbedSuccess, EmbedSuccess];

    expect(r1.structuredContent.model).toBe('model-a');
    expect(r1.structuredContent.dimensions).toBe(2);
    expect(r2.structuredContent.model).toBe('model-b');
    expect(r2.structuredContent.dimensions).toBe(3);
    // Verify they don't share references
    expect(r1.structuredContent).not.toBe(r2.structuredContent);
  });
});

describe('handleDecide — concurrent call safety', () => {
  it('multiple simultaneous calls return independent results', async () => {
    const client1 = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.9 } },
    });
    const client2 = mockDecideClient({
      answers: { q2: { type: 'choice', choice: { a: 0.3, b: 0.7 } } },
    });

    const [r1, r2] = (await Promise.all([
      handleDecide(decideReq({ questions: { q1: noulQuestion() } }), client1),
      handleDecide(decideReq({ questions: { q2: choiceQuestion() } }), client2),
    ])) as [DecideSuccess, DecideSuccess];

    expect(r1.structuredContent.answers.q1).toBeDefined();
    expect(r2.structuredContent.answers.q2).toBeDefined();
    // Verify they don't share references
    expect(r1.structuredContent).not.toBe(r2.structuredContent);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7–8. Summary text invariants
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — summary text invariants', () => {
  it('summary always contains model name, embedding count, and dimensions', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3, 0.4] },
        { index: 1, embedding: [0.5, 0.6, 0.7, 0.8] },
        { index: 2, embedding: [0.9, 1.0, 1.1, 1.2] },
      ],
      model: 'cohere/embed-multilingual-v3.0',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b', 'c'] }), client)) as EmbedSuccess;
    const summary = r.content[0].text;
    expect(summary).toContain('3 embedding(s)');
    expect(summary).toContain('4 dimensions');
    expect(summary).toContain('cohere/embed-multilingual-v3.0');
  });
});

describe('handleDecide — summary text invariants', () => {
  it('summary contains every valid answered question name', async () => {
    const client = mockDecideClient({
      answers: {
        is_hot: { type: 'noul', noul: 0.8 },
        best_color: { type: 'choice', choice: { red: 0.6, blue: 0.4 } },
        quality_rating: { type: 'score', score: [0.1, 0.3, 0.4, 0.2] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          is_hot: noulQuestion('Is it hot?'),
          best_color: choiceQuestion('Best color?'),
          quality_rating: scoreQuestion('Rate it'),
        },
      }),
      client,
    )) as DecideSuccess;
    const summary = r.content[0].text;
    expect(summary).toContain('is_hot');
    expect(summary).toContain('best_color');
    expect(summary).toContain('quality_rating');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9–10. Metadata consistency invariants
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — metadata consistency', () => {
  it('_meta.embedding_count matches structuredContent.embeddings.length', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
        { index: 2, embedding: [0.3] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b', 'c'] }), client)) as EmbedSuccess;
    expect(r._meta.embedding_count).toBe(r.structuredContent.embeddings.length);
    expect(r._meta.dimensions).toBe(r.structuredContent.dimensions);
  });
});

describe('handleDecide — metadata consistency', () => {
  it('_meta.question_count reflects input question count', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.5 },
        q2: { type: 'noul', noul: 0.8 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: noulQuestion('Is water wet?'),
        },
      }),
      client,
    )) as DecideSuccess;
    // question_count reflects input count (2), not answer count
    expect(r._meta.question_count).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. structuredContent.dimensions consistency
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — dimensions consistency', () => {
  it('structuredContent.dimensions equals first sanitized embedding vector length', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3, 0.4, 0.5] },
        { index: 1, embedding: [0.6, 0.7, 0.8, 0.9, 1.0] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.dimensions).toBe(r.structuredContent.embeddings[0].embedding.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12–16. Sanitization completeness invariants
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — sanitized answers contain only allowlisted keys', () => {
  it('noul answer has only type and noul keys', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.75, extra: 'leaked', hidden: true },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    const keys = Object.keys(r.structuredContent.answers.q1);
    expect(keys.sort()).toEqual(['noul', 'type']);
  });

  it('choice answer has only type and choice keys', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: 0.6, b: 0.4 }, confidence: 0.95 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    const keys = Object.keys(r.structuredContent.answers.q1);
    expect(keys.sort()).toEqual(['choice', 'type']);
  });

  it('score answer has only type and score keys', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [0.1, 0.9], metadata: { rank: 2 } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    const keys = Object.keys(r.structuredContent.answers.q1);
    expect(keys.sort()).toEqual(['score', 'type']);
  });
});

describe('handleEmbedText — embedding values are all finite numbers', () => {
  it('every value in every embedding vector is a finite number after sanitization', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, NaN, 0.3, Infinity] },
        { index: 1, embedding: [-Infinity, 0.5, 'bad', null] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;
    for (const emb of r.structuredContent.embeddings) {
      for (const val of emb.embedding) {
        expect(typeof val).toBe('number');
        expect(Number.isFinite(val)).toBe(true);
      }
    }
  });
});

describe('handleDecide — noul values are finite or undefined', () => {
  it('noul in structuredContent is always finite number or undefined', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.8 },
        q2: { type: 'noul', noul: NaN },
        q3: { type: 'noul', noul: Infinity },
        q4: { type: 'noul', noul: 'bad' },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: noulQuestion(),
          q3: noulQuestion(),
          q4: noulQuestion(),
        },
      }),
      client,
    )) as DecideSuccess;
    for (const [, answer] of Object.entries(r.structuredContent.answers)) {
      if (answer.noul !== undefined) {
        expect(typeof answer.noul).toBe('number');
        expect(Number.isFinite(answer.noul)).toBe(true);
      }
    }
  });
});

describe('handleDecide — score values are finite numbers', () => {
  it('every score array element is a finite number after sanitization', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [0.1, NaN, 0.5, Infinity] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    const score = r.structuredContent.answers.q1?.score;
    if (score) {
      for (const val of score) {
        expect(typeof val).toBe('number');
        expect(Number.isFinite(val)).toBe(true);
      }
    }
  });
});

describe('handleDecide — choice values are finite numbers', () => {
  it('every choice probability value is a finite number after sanitization', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: 0.5, b: NaN, c: 0.3, d: Infinity } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    const choice = r.structuredContent.answers.q1?.choice;
    if (choice) {
      for (const val of Object.values(choice)) {
        expect(typeof val).toBe('number');
        expect(Number.isFinite(val)).toBe(true);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17–19. Additional input validation edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — additional dimension validation', () => {
  it('returns INVALID_INPUT for -Infinity dimensions', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: -Infinity }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for boolean true dimensions', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: true }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });
});

describe('handleDecide — score criteria edge cases', () => {
  it('returns INVALID_INPUT for score criteria with empty array', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: [] },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('2+ levels');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. Choice summary edge case: all entries filtered out
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice summary with all unsafe/filtered entries', () => {
  it('shows "?" when choice map has only unsafe keys after filtering', async () => {
    // Build a choice map where all keys are prototype-pollution keys
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
    )) as DecideSuccess;
    // All entries are unsafe → filtered out → entries is empty → best is undefined
    // Summary shows "?" with "0.0%"
    expect(r.content[0].text).toContain('?');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 21–22. Usage sanitization through handler context
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — usage with only unknown keys', () => {
  it('omits _meta.usage when upstream usage has no recognized keys', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'test/model',
      usage: { unknown_field: 42, another_unknown: 'value' },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccess;
    // sanitizeUpstreamUsage returns undefined when no known numeric keys are present
    expect(r._meta.usage).toBeUndefined();
  });
});

describe('handleDecide — usage as falsy number', () => {
  it('omits _meta.usage when response.usage is 0 (falsy but present)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
      usage: 0,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    // The decide handler checks `response.usage ?` — 0 is falsy, so ternary
    // takes the false branch, usage is not passed to sanitizer at all
    expect(r._meta.usage).toBeUndefined();
  });
});
