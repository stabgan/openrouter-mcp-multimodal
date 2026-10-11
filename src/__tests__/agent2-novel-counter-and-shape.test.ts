/**
 * Agent 2 — Novel coverage for genuinely untested paths in embed_text and
 * decide handlers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Genuinely novel test cases (confirmed not covered by any existing test):
 *
 * decide — processedAnswers counter vs skip interactions:
 *  1. Skipped entries (unsafe keys, long names, null) do NOT decrement the
 *     cap → valid entries AFTER skipped ones are still processed.
 *  2. Mix of skipped + valid entries where valid count equals question count
 *     but total answer keys exceed it.
 *  3. All upstream answers are skippable (all null) → empty sanitizedAnswers
 *     but no crash; structuredContent.answers is empty object.
 *
 * decide — response key-set verification:
 *  4. Verify exact keys in return object: content, structuredContent, _meta.
 *  5. Verify exact keys in structuredContent: only 'answers'.
 *  6. Verify exact keys in _meta: server_version, model, question_count,
 *     and optionally usage.
 *
 * embed_text — response key-set verification:
 *  7. Verify exact keys in return object: content, structuredContent, _meta.
 *  8. Verify exact keys in structuredContent: embeddings, model, dimensions.
 *  9. Each embedding has exactly { index, embedding } — no extra keys.
 *
 * embed_text — texts array with undefined element:
 * 10. `texts: ['valid', undefined]` → typeof undefined !== 'string' → error.
 *
 * decide — noul answer with type but no probability fields:
 * 11. `{ type: 'noul' }` (no noul field) → safeNoul = undefined in
 *     structuredContent, summary defaults to P=0 → NO.
 *
 * decide — score answer where valid values are beyond NaN values:
 * 12. `score: [NaN, NaN, 0.8, NaN]` → summary finds max at index 2.
 *
 * decide — choice answer with only unsafe keys in choice map:
 * 13. `{ type: 'choice', choice: { __proto__: 0.9, constructor: 0.8 } }` →
 *     all stripped → empty safeChoice, summary shows "?" at 0.0%.
 *
 * embed_text — response where ALL embedding values are non-finite:
 * 14. Every value in every vector is NaN/Infinity/string → all replaced with 0.
 *
 * decide — answers where only a single valid answer exists after skips:
 * 15. Many answers but only one is valid and processable.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { SERVER_VERSION } from '../version.js';
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
    criteria: { red: 'Color red', blue: 'Color blue' },
  };
}

function scoreQuestion(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–3. decide — processedAnswers counter vs skip interactions
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — processedAnswers counter interaction with skips', () => {
  it('processes valid answers AFTER skipped unsafe/long/null entries up to question count', async () => {
    // 2 questions asked, but upstream returns 6 answers:
    // - 3 skippable (unsafe key, long key, null entry)
    // - 3 valid (q1, q2, extra_valid)
    // processedAnswers should only count valid ones → caps at 2
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.99 }; // skipped (unsafe key)
    answers['q'.repeat(257)] = { type: 'noul', noul: 0.88 }; // skipped (long key)
    answers['bad'] = null; // skipped (non-object)
    answers['q1'] = { type: 'noul', noul: 0.7 }; // processed (1st)
    answers['q2'] = { type: 'noul', noul: 0.3 }; // processed (2nd)
    answers['extra_valid'] = { type: 'noul', noul: 0.5 }; // should be dropped (cap reached)

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    // Only q1 and q2 should appear; extra_valid exceeds the 2-question cap
    const answerKeys = Object.keys(r.structuredContent.answers);
    expect(answerKeys).toContain('q1');
    expect(answerKeys).toContain('q2');
    expect(answerKeys).not.toContain('extra_valid');
    // Skipped entries should definitely not appear
    expect(answerKeys).not.toContain('bad');
  });

  it('does not count skipped entries toward the cap', async () => {
    // 1 question asked. Upstream returns: 5 skippable + 1 valid.
    // The valid entry should still be processed despite being 6th in iteration.
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.9 }; // skipped
    answers['constructor'] = { type: 'noul', noul: 0.8 }; // skipped
    answers['prototype'] = { type: 'noul', noul: 0.7 }; // skipped
    answers['also_null'] = null; // skipped
    answers['also_number'] = 42; // skipped (typeof !== 'object')
    answers['q1'] = { type: 'noul', noul: 0.65 }; // the only valid one

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    expect(r.structuredContent.answers.q1).toBeDefined();
    expect(r.structuredContent.answers.q1.noul).toBe(0.65);
    expect(r.content[0].text).toContain('YES');
    expect(r.content[0].text).toContain('65.0%');
  });

  it('returns empty answers object when all upstream entries are skippable', async () => {
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.9 };
    answers['garbage'] = null;
    answers['also_bad'] = 'string';

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    // All answers skipped → empty sanitizedAnswers, empty summary
    expect(Object.keys(r.structuredContent.answers)).toHaveLength(0);
    expect(r.content[0].text).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4–6. decide — exact response key-set verification
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — response key-set verification', () => {
  it('returns exactly content, structuredContent, and _meta at top level', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    const topKeys = Object.keys(r).sort();
    expect(topKeys).toEqual(['_meta', 'content', 'structuredContent']);
  });

  it('structuredContent has exactly the "answers" key', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    expect(Object.keys(r.structuredContent)).toEqual(['answers']);
  });

  it('_meta has exactly server_version, model, question_count (no usage when absent)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    const metaKeys = Object.keys(r._meta).sort();
    expect(metaKeys).toEqual(['model', 'question_count', 'server_version']);
    expect(r._meta.server_version).toBe(SERVER_VERSION);
    expect(r._meta.model).toBe('typesafe/jev-1.13');
    expect(r._meta.question_count).toBe(1);
  });

  it('_meta includes usage key when upstream provides valid usage', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
      usage: { prompt_tokens: 10, total_tokens: 15 },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    const metaKeys = Object.keys(r._meta).sort();
    expect(metaKeys).toEqual(['model', 'question_count', 'server_version', 'usage']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7–9. embed_text — exact response key-set verification
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response key-set verification', () => {
  it('returns exactly content, structuredContent, and _meta at top level', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;

    const topKeys = Object.keys(r).sort();
    expect(topKeys).toEqual(['_meta', 'content', 'structuredContent']);
  });

  it('structuredContent has exactly embeddings, model, dimensions', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;

    expect(Object.keys(r.structuredContent).sort()).toEqual(['dimensions', 'embeddings', 'model']);
  });

  it('each sanitized embedding has exactly index and embedding keys', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1], extra_field: 'leaked', object: 'embedding' },
        { index: 1, embedding: [0.2], metadata: { source: 'test' } },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;

    for (const emb of r.structuredContent.embeddings) {
      const keys = Object.keys(emb).sort();
      expect(keys).toEqual(['embedding', 'index']);
    }
  });

  it('_meta has exactly server_version, model, embedding_count, dimensions (no usage)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;

    const metaKeys = Object.keys(r._meta).sort();
    expect(metaKeys).toEqual(['dimensions', 'embedding_count', 'model', 'server_version']);
  });

  it('_meta includes usage key when upstream provides valid usage', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'test/model',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;

    const metaKeys = Object.keys(r._meta).sort();
    expect(metaKeys).toEqual(['dimensions', 'embedding_count', 'model', 'server_version', 'usage']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. embed_text — texts array with undefined element
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — undefined element in texts array', () => {
  it('returns INVALID_INPUT when a text element is undefined', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: ['valid', undefined] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('returns INVALID_INPUT when first text element is undefined', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [undefined] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. decide — noul answer with type field but no noul property
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — noul answer with missing noul field', () => {
  it('sets safeNoul to undefined in structuredContent and defaults to NO at 0%', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul' } }, // no noul property at all
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    // structuredContent: safeNoul should be undefined since answer.noul is undefined
    // (typeof undefined !== 'number' → safeNoul = undefined)
    expect(r.structuredContent.answers.q1.type).toBe('noul');
    expect(r.structuredContent.answers.q1.noul).toBeUndefined();

    // summary: typeof undefined !== 'number' → prob = 0 → NO at 0.0%
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. decide — score where valid values appear after NaN values
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score with NaN before valid values', () => {
  it('finds max at correct index when valid values follow NaN entries', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [NaN, NaN, 0.8, NaN] } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: ['a', 'b', 'c', 'd'] },
        },
      }),
      client,
    )) as DecideSuccess;

    // NaN values fail typeof === 'number' check in the loop → skipped.
    // Index 2 (0.8) is the only valid value → maxIdx = 2.
    expect(r.content[0].text).toContain('level 3/4'); // 0-indexed 2 → "level 3/4"
    expect(r.content[0].text).toContain('80.0%');

    // structuredContent: NaN replaced with 0, valid preserved
    expect(r.structuredContent.answers.q1.score).toEqual([0, 0, 0.8, 0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. decide — choice answer where ALL keys in choice map are unsafe
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice answer with only unsafe keys in choice map', () => {
  it('produces empty safeChoice and shows "?" at 0.0% in summary', async () => {
    const unsafeChoice = Object.create(null);
    unsafeChoice['__proto__'] = 0.9;
    unsafeChoice['constructor'] = 0.8;
    unsafeChoice['prototype'] = 0.7;

    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: unsafeChoice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;

    // All unsafe keys stripped → empty safeChoice
    expect(r.structuredContent.answers.q1.choice).toEqual({});

    // Summary: entries.filter strips unsafe keys → entries = [] → best = undefined → "?"
    expect(r.content[0].text).toContain('?');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. embed_text — response where all embedding values are non-finite
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — all non-finite values across multiple embeddings', () => {
  it('replaces every value with 0 across all embeddings in batch', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [NaN, Infinity, -Infinity] },
        { index: 1, embedding: ['string', null, undefined] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;

    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0, 0]);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([0, 0, 0]);
    // Dimensions come from first.embedding.length (raw, before sanitization)
    expect(r.structuredContent.dimensions).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. decide — single valid answer among many skippable entries
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — single valid answer among many skippable entries', () => {
  it('processes the one valid answer correctly', async () => {
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.99 };
    answers['constructor'] = { type: 'choice', choice: { a: 0.5, b: 0.5 } };
    answers['prototype'] = { type: 'score', score: [0.1, 0.9] };
    answers['too_' + 'long'.repeat(70)] = { type: 'noul', noul: 0.88 }; // > 256 chars
    answers['null_entry'] = null;
    answers['number_entry'] = 42;
    answers['string_entry'] = 'garbage';
    answers['q1'] = { type: 'choice', choice: { red: 0.2, blue: 0.8 } }; // only valid one

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;

    // Only q1 should be in the final result
    expect(Object.keys(r.structuredContent.answers)).toEqual(['q1']);
    expect(r.structuredContent.answers.q1.type).toBe('choice');
    expect(r.structuredContent.answers.q1.choice).toEqual({ red: 0.2, blue: 0.8 });
    expect(r.content[0].text).toContain('blue');
    expect(r.content[0].text).toContain('80.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bonus: decide — sanitized answer for each type has exactly expected keys
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — sanitized answer objects have exactly expected keys', () => {
  it('noul answer has exactly { type, noul } keys', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.75, extra: 'leaked', confidence: 'high' },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    const answer = r.structuredContent.answers.q1 as Record<string, unknown>;
    expect(Object.keys(answer).sort()).toEqual(['noul', 'type']);
    expect(answer.type).toBe('noul');
    expect(answer.noul).toBe(0.75);
  });

  it('choice answer has exactly { type, choice } keys', async () => {
    const client = mockDecideClient({
      answers: {
        q1: {
          type: 'choice',
          choice: { red: 0.3, blue: 0.7 },
          extra: 'leaked',
          probabilities: [0.3, 0.7],
        },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;

    const answer = r.structuredContent.answers.q1 as Record<string, unknown>;
    expect(Object.keys(answer).sort()).toEqual(['choice', 'type']);
    expect(answer.type).toBe('choice');
  });

  it('score answer has exactly { type, score } keys', async () => {
    const client = mockDecideClient({
      answers: {
        q1: {
          type: 'score',
          score: [0.1, 0.3, 0.6],
          extra: 'leaked',
          raw_levels: ['bad', 'ok', 'good'],
        },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;

    const answer = r.structuredContent.answers.q1 as Record<string, unknown>;
    expect(Object.keys(answer).sort()).toEqual(['score', 'type']);
    expect(answer.type).toBe('score');
  });

  it('unknown type answer has exactly { type } key', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'future_type', value: 42, data: { nested: true }, extra: 'leaked' },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    const answer = r.structuredContent.answers.q1 as Record<string, unknown>;
    expect(Object.keys(answer)).toEqual(['type']);
    expect(answer.type).toBe('future_type');
  });
});
