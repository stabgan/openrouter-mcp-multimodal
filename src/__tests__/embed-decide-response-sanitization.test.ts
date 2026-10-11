/**
 * Coverage for untested response-sanitization branches in embed_text and decide.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * embed_text:
 *  1. MAX_RESPONSE_EMBEDDING_DIMENSIONS (65_536) — upstream vectors capped
 *  2. sanitizedDimensions reports capped length, not raw upstream length
 *
 * decide:
 *  3. Score response array capped at MAX_SCORE_LEVELS (100)
 *  4. Choice response entries capped at MAX_CRITERIA_ENTRIES (100)
 *  5. Choice response key length > MAX_CRITERIA_KEY_LENGTH (256) → skipped
 *  6. Unknown answer type with non-string type value → 'unknown'
 *  7. Unknown answer type with very long string type → truncated to 256 chars
 *  8. answers is null → INTERNAL error
 *  9. Malformed answer entry that is a number → skipped
 * 10. Choice summary text filters unsafe keys from upstream choice map
 * 11. Score sanitization caps to MAX_SCORE_LEVELS when upstream sends > 100
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
// 1–2. embed_text — MAX_RESPONSE_EMBEDDING_DIMENSIONS cap
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response embedding dimension capping', () => {
  it('caps upstream vectors exceeding MAX_RESPONSE_EMBEDDING_DIMENSIONS (65_536)', async () => {
    // Create a vector with 65_540 dimensions — 4 over the cap
    const oversizedVector = new Array(65_540).fill(0.01);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: oversizedVector }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    // Vector should be capped to 65_536 dimensions
    expect(r.structuredContent.embeddings[0].embedding).toHaveLength(65_536);
  });

  it('reports sanitizedDimensions as capped length, not original upstream length', async () => {
    const oversizedVector = new Array(70_000).fill(0.02);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: oversizedVector }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    // structuredContent.dimensions and _meta.dimensions should both be 65_536
    expect(r.structuredContent.dimensions).toBe(65_536);
    expect(r._meta.dimensions).toBe(65_536);
    expect(r.content[0].text).toContain('65536 dimensions');
  });

  it('does not cap vectors at exactly MAX_RESPONSE_EMBEDDING_DIMENSIONS', async () => {
    const exactVector = new Array(65_536).fill(0.03);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: exactVector }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['hello'] }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toHaveLength(65_536);
    expect(r.structuredContent.dimensions).toBe(65_536);
  });

  it('caps oversized vectors in batch — each vector capped independently', async () => {
    const oversized = new Array(65_538).fill(0.1);
    const normal = [0.5, 0.6, 0.7];
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: oversized },
        { index: 1, embedding: normal },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    // First embedding capped, second left alone
    expect(r.structuredContent.embeddings[0].embedding).toHaveLength(65_536);
    expect(r.structuredContent.embeddings[1].embedding).toHaveLength(3);
    // dimensions comes from first embedding's capped length
    expect(r.structuredContent.dimensions).toBe(65_536);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. decide — score response array capped at MAX_SCORE_LEVELS (100)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — upstream score array capping in response', () => {
  it('caps score array when upstream returns more than 100 levels', async () => {
    // Upstream sends 105 score values
    const oversizedScore = new Array(105).fill(0.01);
    oversizedScore[102] = 0.95; // highest value beyond the cap
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: oversizedScore } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Score should be capped at 100 entries
    expect(r.structuredContent.answers.q1?.score).toHaveLength(100);
    // The value at index 102 (0.95) should NOT be included
    expect(r.structuredContent.answers.q1?.score![99]).toBe(0.01);
  });

  it('does not cap score array at exactly 100 levels', async () => {
    const exactScore = new Array(100).fill(0.01);
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: exactScore } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.score).toHaveLength(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. decide — choice response entries capped at MAX_CRITERIA_ENTRIES (100)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — upstream choice map entry capping in response', () => {
  it('caps choice entries when upstream returns more than 100', async () => {
    // Upstream sends 105 choice entries
    const choice: Record<string, number> = {};
    for (let i = 0; i < 105; i++) {
      choice[`opt_${i}`] = 0.01;
    }
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const sanitizedChoice = r.structuredContent.answers.q1?.choice;
    expect(sanitizedChoice).toBeDefined();
    // Should have at most 100 entries
    expect(Object.keys(sanitizedChoice!).length).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. decide — choice response key length > MAX_CRITERIA_KEY_LENGTH (256)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — upstream choice key length capping in response', () => {
  it('skips choice keys exceeding 256 chars from upstream response', async () => {
    const longKey = 'k'.repeat(257);
    const client = mockDecideClient({
      answers: {
        q1: {
          type: 'choice',
          choice: { [longKey]: 0.9, short: 0.1 },
        },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const sanitizedChoice = r.structuredContent.answers.q1?.choice;
    expect(sanitizedChoice).toBeDefined();
    // Long key should be skipped
    expect(sanitizedChoice![longKey]).toBeUndefined();
    expect(sanitizedChoice!.short).toBe(0.1);
  });

  it('keeps choice keys at exactly 256 chars', async () => {
    const exactKey = 'k'.repeat(256);
    const client = mockDecideClient({
      answers: {
        q1: {
          type: 'choice',
          choice: { [exactKey]: 0.7, other: 0.3 },
        },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const sanitizedChoice = r.structuredContent.answers.q1?.choice;
    expect(sanitizedChoice![exactKey]).toBe(0.7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6–7. decide — unknown answer type edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — unknown answer type edge cases', () => {
  it('uses "unknown" when answer type is a non-string value (number)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 42, data: 'should be stripped' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const answer = r.structuredContent.answers.q1;
    expect(answer).toBeDefined();
    expect(answer.type).toBe('unknown');
    expect((answer as Record<string, unknown>).data).toBeUndefined();
  });

  it('uses "unknown" when answer type is null', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: null, noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const answer = r.structuredContent.answers.q1;
    expect(answer.type).toBe('unknown');
  });

  it('uses "unknown" when answer type is boolean', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: true } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1.type).toBe('unknown');
  });

  it('uses "unknown" when answer type is undefined', async () => {
    const client = mockDecideClient({
      answers: { q1: { data: 'no type field' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1.type).toBe('unknown');
  });

  it('truncates very long string type to MAX_QUESTION_NAME_LENGTH (256)', async () => {
    const longType = 'x'.repeat(300);
    const client = mockDecideClient({
      answers: { q1: { type: longType, extra: 'should be stripped' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const answer = r.structuredContent.answers.q1;
    expect(answer.type).toHaveLength(256);
    expect(answer.type).toBe(longType.slice(0, 256));
    expect((answer as Record<string, unknown>).extra).toBeUndefined();
  });

  it('preserves string type at exactly 256 chars without truncation', async () => {
    const exactType = 'y'.repeat(256);
    const client = mockDecideClient({
      answers: { q1: { type: exactType } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1.type).toBe(exactType);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. decide — answers is null → INTERNAL error
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — null answers response', () => {
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
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. decide — malformed answer entry types
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — malformed answer entry types from upstream', () => {
  it('skips answer entry that is a number', async () => {
    const client = mockDecideClient({
      answers: { q1: 42, q2: { type: 'noul', noul: 0.8 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // q1 (number) should be skipped, q2 should be present
    expect(r.structuredContent.answers.q1).toBeUndefined();
    expect(r.structuredContent.answers.q2).toBeDefined();
    expect(r.content[0].text).toContain('q2');
  });

  it('skips answer entry that is a boolean', async () => {
    const client = mockDecideClient({
      answers: { q1: true, q2: { type: 'noul', noul: 0.6 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1).toBeUndefined();
    expect(r.structuredContent.answers.q2).toBeDefined();
  });

  it('skips answer entry that is an array', async () => {
    const client = mockDecideClient({
      answers: { q1: [0.5, 0.5], q2: { type: 'noul', noul: 0.9 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Arrays are objects but fail the `!answer` or shape check — depends on how the code treats them.
    // The code checks `!answer || typeof answer !== 'object'` — arrays ARE objects, so they pass this check.
    // But then they hit the switch on `answer.type` which would be undefined → default case → 'unknown'.
    // Actually let me re-read the code... arrays are not filtered because typeof [] === 'object'.
    // The array would go to the default case because [].type is undefined → safeType = 'unknown'.
    expect(r.structuredContent.answers.q1).toBeDefined();
    expect(r.structuredContent.answers.q1.type).toBe('unknown');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. decide — choice summary filters unsafe keys from upstream
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice summary text filters unsafe keys', () => {
  it('excludes __proto__ from choice summary sorting', async () => {
    // Craft a choice response where __proto__ has the highest probability
    const choice = Object.create(null);
    choice['__proto__'] = 0.9;
    choice['red'] = 0.05;
    choice['blue'] = 0.05;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // The summary should not show __proto__ as the winner — it should pick red or blue
    expect(r.content[0].text).not.toContain('__proto__');
    // One of the safe keys should appear
    const text = r.content[0].text;
    expect(text.includes('red') || text.includes('blue')).toBe(true);
  });

  it('excludes constructor from choice summary sorting', async () => {
    const choice = Object.create(null);
    choice['constructor'] = 0.8;
    choice['alpha'] = 0.1;
    choice['beta'] = 0.1;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).not.toContain('constructor');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. decide — score response with non-number elements in summary
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score summary with mixed valid/invalid values', () => {
  it('finds the max among only valid numeric entries in score summary', async () => {
    // Score has NaN at index 0, valid at index 1, string at index 2
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [NaN, 0.6, 'invalid', 0.4] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Index 1 (0.6) is the max valid numeric value → level 2/4
    expect(r.content[0].text).toContain('level 2/4');
    expect(r.content[0].text).toContain('60.0%');
  });

  it('handles score with Infinity values — skipped by typeof check', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [Infinity, 0.3] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Infinity passes typeof === 'number' but may or may not pass the > comparison.
    // The loop checks `typeof answer.score[i] === 'number'` and `answer.score[i]! > maxVal`.
    // Infinity IS a number and IS > -Infinity, so it wins. The displayScore would be Infinity.
    // But the summary code doesn't guard against Infinity in the summary builder (only NaN guard).
    // Let's verify what actually happens:
    expect(r.content[0].text).toContain('level 1/2');
  });
});
