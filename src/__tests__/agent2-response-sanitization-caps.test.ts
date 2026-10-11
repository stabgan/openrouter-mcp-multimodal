/**
 * Coverage for untested response-sanitization caps in embed_text and decide.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file only
 * adds NEW test cases in src/__tests__/ and does NOT modify source code.
 *
 * Targets four defence-in-depth response caps with ZERO prior test coverage
 * (verified via exhaustive grep across all 114 test files):
 *
 * embed_text — per-vector dimension cap:
 *  1. Upstream embedding with > 65_536 elements → sliced to 65_536
 *  2. Upstream embedding at exactly 65_536 elements → not sliced
 *  3. Multiple embeddings where only some exceed the cap → only oversized ones sliced
 *
 * decide — choice response count cap (MAX_CRITERIA_ENTRIES = 100):
 *  4. Upstream choice map with > 100 entries → capped at 100
 *  5. Upstream choice map at exactly 100 entries → all preserved
 *
 * decide — choice response key length cap (MAX_CRITERIA_KEY_LENGTH = 256):
 *  6. Upstream choice key exceeding 256 chars → skipped
 *  7. Upstream choice key at exactly 256 chars → preserved
 *
 * decide — score response array length cap (MAX_SCORE_LEVELS = 100):
 *  8. Upstream score array with > 100 elements → sliced to 100
 *  9. Upstream score array at exactly 100 elements → not sliced
 * 10. Sliced score array still sanitises non-finite values to 0
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function choiceQuestion() {
  return {
    type: 'choice' as const,
    instructions: 'Pick one',
    criteria: { a: 'Option A', b: 'Option B' },
  };
}

function scoreQuestion() {
  return {
    type: 'score' as const,
    instructions: 'Rate quality',
    criteria: ['poor', 'good'],
  };
}

// ===========================================================================
// 1–3. embed_text — per-vector dimension cap (MAX_RESPONSE_EMBEDDING_DIMENSIONS = 65_536)
// ===========================================================================

describe('handleEmbedText — per-vector dimension cap on upstream response', () => {
  it('slices embedding vectors exceeding 65_536 dimensions', async () => {
    // Build a vector with 65_537 elements — 1 over the cap
    const oversized = new Array(65_537).fill(0.1);
    oversized[65_536] = 0.99; // sentinel at position beyond the cap
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: oversized }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    // Vector should be sliced to 65_536 elements
    expect(r.structuredContent.embeddings[0].embedding).toHaveLength(65_536);
    // Sentinel at position 65_536 should be gone
    expect(r.structuredContent.embeddings[0].embedding[65_535]).toBe(0.1);
  });

  it('preserves embedding vectors at exactly 65_536 dimensions', async () => {
    const exact = new Array(65_536).fill(0.5);
    exact[65_535] = 0.99; // last element sentinel
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: exact }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toHaveLength(65_536);
    // Last element preserved (not sliced)
    expect(r.structuredContent.embeddings[0].embedding[65_535]).toBe(0.99);
  });

  it('only slices oversized vectors in a batch, leaving normal ones intact', async () => {
    const normal = [0.1, 0.2, 0.3];
    const oversized = new Array(65_537).fill(0.5);
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: normal },
        { index: 1, embedding: oversized },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    // First embedding: 3 elements, untouched
    expect(r.structuredContent.embeddings[0].embedding).toHaveLength(3);
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0.2, 0.3]);
    // Second embedding: sliced from 65_537 to 65_536
    expect(r.structuredContent.embeddings[1].embedding).toHaveLength(65_536);
  });
});

// ===========================================================================
// 4–5. decide — choice response count cap (MAX_CRITERIA_ENTRIES = 100)
// ===========================================================================

describe('handleDecide — choice response count cap from upstream', () => {
  it('caps choice map entries at 100 when upstream returns more', async () => {
    // Build a choice map with 105 entries
    const bigChoice: Record<string, number> = {};
    for (let i = 0; i < 105; i++) {
      bigChoice[`opt_${i}`] = i / 105;
    }
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: bigChoice } },
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

  it('preserves all entries in choice map at exactly 100', async () => {
    const exactChoice: Record<string, number> = {};
    for (let i = 0; i < 100; i++) {
      exactChoice[`opt_${i}`] = 0.01;
    }
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: exactChoice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const sanitizedChoice = r.structuredContent.answers.q1?.choice;
    expect(Object.keys(sanitizedChoice!)).toHaveLength(100);
  });
});

// ===========================================================================
// 6–7. decide — choice response key length cap (MAX_CRITERIA_KEY_LENGTH = 256)
// ===========================================================================

describe('handleDecide — choice response key length cap from upstream', () => {
  it('skips choice keys exceeding 256 chars from upstream', async () => {
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
    // Short key preserved
    expect(sanitizedChoice!.short).toBe(0.1);
  });

  it('preserves choice key at exactly 256 chars from upstream', async () => {
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
    // Exactly 256 chars should be preserved
    expect(sanitizedChoice![exactKey]).toBe(0.7);
    expect(sanitizedChoice!.other).toBe(0.3);
  });
});

// ===========================================================================
// 8–10. decide — score response array length cap (MAX_SCORE_LEVELS = 100)
// ===========================================================================

describe('handleDecide — score response array length cap from upstream', () => {
  it('slices score array exceeding 100 elements from upstream', async () => {
    // Build a score array with 105 elements
    const bigScore = new Array(105).fill(0.01);
    bigScore[104] = 0.99; // sentinel at position beyond the cap
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: bigScore } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const sanitizedScore = r.structuredContent.answers.q1?.score;
    expect(sanitizedScore).toBeDefined();
    // Should be sliced to 100 elements
    expect(sanitizedScore!).toHaveLength(100);
    // Sentinel at position 104 should be gone
    expect(sanitizedScore![99]).toBe(0.01);
  });

  it('preserves score array at exactly 100 elements', async () => {
    const exactScore = new Array(100).fill(0.02);
    exactScore[99] = 0.99; // last element sentinel
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: exactScore } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const sanitizedScore = r.structuredContent.answers.q1?.score;
    expect(sanitizedScore!).toHaveLength(100);
    // Last element should be preserved
    expect(sanitizedScore![99]).toBe(0.99);
  });

  it('sanitises non-finite values to 0 within sliced score array', async () => {
    // 102 elements — first 100 should be kept, last 2 discarded
    const mixedScore = new Array(102).fill(0.5);
    mixedScore[0] = NaN;
    mixedScore[1] = Infinity;
    mixedScore[2] = -Infinity;
    mixedScore[99] = 0.77; // last element within cap
    mixedScore[100] = 0.88; // first element beyond cap (discarded)
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: mixedScore } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const sanitizedScore = r.structuredContent.answers.q1?.score;
    expect(sanitizedScore!).toHaveLength(100);
    // Non-finite values replaced with 0
    expect(sanitizedScore![0]).toBe(0); // NaN → 0
    expect(sanitizedScore![1]).toBe(0); // Infinity → 0
    expect(sanitizedScore![2]).toBe(0); // -Infinity → 0
    // Valid values preserved
    expect(sanitizedScore![3]).toBe(0.5);
    expect(sanitizedScore![99]).toBe(0.77);
  });
});
