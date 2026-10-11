/**
 * Agent 2 — Novel summary & sanitization gaps.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Genuinely untested paths (verified via exhaustive grep):
 *
 * decide — choice SUMMARY building filters unsafe keys independently:
 *  1. __proto__ key in upstream choice map → filtered from summary sort
 *  2. constructor key in upstream choice map → filtered from summary sort
 *  3. All choice keys are unsafe → entries empty → best = undefined → "?" at 0.0%
 *  4. Mix of unsafe and valid keys → only valid appear in sorted summary
 *
 * decide — noul SUMMARY where answer.noul is explicitly undefined:
 *  5. answer.noul is undefined → typeof check fails → prob = 0 → "NO (P=0.0%)"
 *
 * decide — choice summary where answer.choice is an array (truthy non-object):
 *  6. answer.choice is [0.5, 0.3] → Object.entries on array → indexed keys in summary
 *
 * embed_text — non-first embedding with non-array embedding field:
 *  7. Second embedding has embedding: {} → rawEmbedding = [] → safeEmbedding = []
 *  8. Second embedding has embedding: null → rawEmbedding = [] → safeEmbedding = []
 *  9. Second embedding has embedding: 'string' → rawEmbedding = [] → safeEmbedding = []
 *
 * embed_text — arguments is null (not undefined):
 * 10. request.params.arguments = null → fallback to empty object → INVALID_INPUT
 *
 * decide — arguments is null (not undefined):
 * 11. request.params.arguments = null → fallback to empty object → INVALID_INPUT
 *
 * decide — score summary where answer.score has -Infinity values mixed with valid:
 * 12. score = [-Infinity, 0.6, 0.4] → maxVal = 0.6 at index 1 → correct level
 *
 * decide — choice summary with prototype key as highest probability:
 * 13. prototype key with 0.99, normal key with 0.01 → prototype filtered → normal wins
 *
 * decide — score structuredContent capping + summary interaction:
 * 14. Score with 105 elements → structuredContent capped at 100, but summary uses
 *     raw answer.score (uncapped) — verify both paths work correctly
 *
 * embed_text — embedding sanitization for non-first elements with various invalid types:
 * 15. Batch of 3 embeddings where 2nd has index: -1 and 3rd has index: NaN
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
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  return { submitDecision: vi.fn().mockResolvedValue(response) } as unknown as OpenRouterAPIClient;
}

function embedReq(args: unknown) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: unknown) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQ(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

function choiceQ(instructions = 'Pick a color') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { red: 'Red color', blue: 'Blue color', green: 'Green color' },
  };
}

function scoreQ(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–4. decide — choice summary building filters unsafe keys
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice summary filters unsafe keys independently', () => {
  it('filters __proto__ from choice summary sort (not just structuredContent)', async () => {
    // The summary building code has its own .filter() that removes unsafe keys
    // before sorting to find the "best" option. This is separate from the
    // structuredContent sanitization.
    const choice = Object.create(null);
    choice['__proto__'] = 0.99;
    choice['valid_option'] = 0.01;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccess;
    // __proto__ has highest prob (0.99) but is filtered → valid_option wins in summary
    expect(r.content[0].text).toContain('valid_option');
    expect(r.content[0].text).not.toContain('__proto__');
  });

  it('filters constructor from choice summary sort', async () => {
    const choice = Object.create(null);
    choice['constructor'] = 0.95;
    choice['normal'] = 0.05;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccess;
    // constructor filtered → normal wins
    expect(r.content[0].text).toContain('normal');
    expect(r.content[0].text).not.toContain('constructor');
  });

  it('shows "?" when all choice keys are unsafe (filtered from summary)', async () => {
    const choice = Object.create(null);
    choice['__proto__'] = 0.6;
    choice['constructor'] = 0.3;
    choice['prototype'] = 0.1;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccess;
    // All keys filtered → entries empty → best undefined → "?" with 0.0%
    expect(r.content[0].text).toContain('?');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('only shows valid keys when mixed with unsafe keys in summary', async () => {
    const choice = Object.create(null);
    choice['__proto__'] = 0.9;
    choice['constructor'] = 0.8;
    choice['real_option'] = 0.7;
    choice['another'] = 0.3;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccess;
    // unsafe keys filtered → real_option (0.7) wins in summary
    expect(r.content[0].text).toContain('real_option');
    expect(r.content[0].text).toContain('70.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. decide — noul summary where answer.noul is explicitly undefined
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — noul summary with undefined noul value', () => {
  it('treats undefined noul as P=0 → NO', async () => {
    // answer has type: 'noul' but no noul field at all
    const client = mockDecideClient({
      answers: { q1: { type: 'noul' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccess;
    // typeof undefined !== 'number' → prob = 0 → NO at 0.0%
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. decide — choice summary where answer.choice is an array
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice summary when choice is an array', () => {
  it('produces summary from array-indexed entries when choice is array', async () => {
    // An array is truthy but Object.entries on [0.5, 0.3] gives [["0", 0.5], ["1", 0.3]]
    // The choice field fails typeof === 'object' check in sanitization → safeChoice = {}
    // But in summary building, answer.choice is truthy → Object.entries runs
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: [0.5, 0.3, 0.2] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccess;
    // Summary should show the array-indexed best entry
    expect(r.content[0].text).toContain('q1');
    expect(r.content[0].text).toContain('50.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7–9. embed_text — non-first embedding with various invalid embedding types
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — non-first embedding with invalid embedding field', () => {
  it('produces empty embedding when second element has embedding: {} (object)', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: {} },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello', 'world'] }),
      client,
    )) as EmbedSuccess;
    // First embedding valid
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0.2]);
    // Second: embedding is not array → rawEmbedding = [] → safeEmbedding = []
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });

  it('produces empty embedding when second element has embedding: null', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.5] },
        { index: 1, embedding: null },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.5]);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });

  it('produces empty embedding when second element has embedding: "string"', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.3, 0.7] },
        { index: 1, embedding: 'not-an-array' },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['x', 'y'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.3, 0.7]);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10–11. embed_text / decide — arguments is null (not undefined)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — arguments is null', () => {
  it('falls back to empty object and returns INVALID_INPUT for texts', async () => {
    const r = (await handleEmbedText(embedReq(null), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts is required');
  });
});

describe('handleDecide — arguments is null', () => {
  it('falls back to empty object and returns INVALID_INPUT for questions', async () => {
    const r = (await handleDecide(decideReq(null), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions is required');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. decide — score summary with -Infinity mixed with valid values
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score summary with -Infinity mixed values', () => {
  it('skips -Infinity and picks valid max from remaining values', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [-Infinity, 0.6, 0.4] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as DecideSuccess;
    // -Infinity: typeof 'number' but the loop checks answer.score[i]! > maxVal
    // -Infinity > -Infinity is false → not selected
    // 0.6 > -Infinity → maxVal = 0.6, maxIdx = 1
    // 0.4 > 0.6 → false
    // Result: level 2/3 at 60.0%
    expect(r.content[0].text).toContain('level 2/3');
    expect(r.content[0].text).toContain('60.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. decide — choice summary where prototype has highest prob
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice summary prototype key filtered', () => {
  it('filters prototype key even when it has highest probability', async () => {
    const choice = Object.create(null);
    choice['prototype'] = 0.99;
    choice['fallback'] = 0.01;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccess;
    // prototype filtered → fallback wins in summary
    expect(r.content[0].text).toContain('fallback');
    expect(r.content[0].text).toContain('1.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. decide — score with >100 elements: structuredContent vs summary
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score capping in structuredContent vs uncapped summary', () => {
  it('caps structuredContent at 100 but summary uses raw score array', async () => {
    // Build score array with 105 elements, max at index 104
    const score = new Array(105).fill(0.01);
    score[104] = 0.99; // sentinel beyond the 100-element cap
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as DecideSuccess;

    // structuredContent capped at 100 — sentinel at 104 is NOT in structuredContent
    expect(r.structuredContent.answers.q1?.score).toHaveLength(100);
    expect(r.structuredContent.answers.q1?.score?.[99]).toBe(0.01); // last included element

    // Summary uses raw answer.score (uncapped) — should find max at index 104
    expect(r.content[0].text).toContain('level 105/105');
    expect(r.content[0].text).toContain('99.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. embed_text — batch with mixed invalid index values
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — batch with various invalid index values', () => {
  it('falls back to positional index for negative and NaN indices', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: -1, embedding: [0.2] },
        { index: NaN, embedding: [0.3] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b', 'c'] }), client)) as EmbedSuccess;
    // First: index 0 (valid) → preserved
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    // Second: index -1 (negative, invalid) → falls back to positional index 1
    expect(r.structuredContent.embeddings[1].index).toBe(1);
    // Third: index NaN (not integer) → falls back to positional index 2
    expect(r.structuredContent.embeddings[2].index).toBe(2);
  });
});
