/**
 * Agent 2 — Final novel coverage for embed_text and decide handlers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Genuinely untested code paths (verified via exhaustive grep across all
 * 130 existing test files):
 *
 * embed_text:
 *  1. `texts: 0` (number zero as scalar) — wraps to [0], typeof fails
 *  2. `texts: ''` (empty string as scalar, not in array) — wraps to [''],
 *     .trim() is empty → error. Only tested in array form previously.
 *  3. response.usage with prototype-pollution key (`__proto__`) —
 *     sanitizeUpstreamUsage returns undefined → _meta.usage omitted.
 *     The unit sanitizer is tested but the handler-level integration is not.
 *  4. response.usage with `constructor` key — same pattern.
 *  5. response.usage containing both valid known keys AND an unsafe key —
 *     unsafe key triggers early rejection, valid keys are also lost.
 *  6. `texts: [42, 'valid']` where a non-string element at index 0 is a number
 *     (distinct from boolean/object which are tested; number scalar is tested
 *      but number-in-array-at-index-0 specifically is not).
 *
 * decide:
 *  7. response.usage with `__proto__` key — handler uses
 *     `response.usage ? { usage: sanitize(...) } : {}` so truthy usage
 *     with unsafe key → sanitizer returns undefined → _meta.usage = undefined.
 *  8. response.usage with `constructor` key — same.
 *  9. response.usage with mix of valid key + unsafe key — unsafe triggers
 *     early rejection, valid key lost.
 * 10. Summary text when a valid noul answer follows a skipped malformed one —
 *     verify exact line count and content.
 * 11. Score summary where exactly one value is valid and all others are
 *     non-number types (object, boolean, null) — verify correct level.
 * 12. Questions where one question has criteria with exactly 2 entries
 *     and another has 100 entries — both pass, verify API call shape.
 * 13. `texts: -0` (negative zero) — Number.isFinite(-0) is true, but -0
 *     wraps to [-0] → typeof -0 !== 'string' → error.
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
  _meta: { code: string; [key: string]: unknown };
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
// 1. embed_text — `texts: 0` (number zero as scalar)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — texts as number zero scalar', () => {
  it('returns INVALID_INPUT when texts is number 0', async () => {
    // 0 is not null/undefined → Array.isArray(0) is false → [0]
    // typeof 0 !== 'string' → error at index 0
    const r = (await handleEmbedText(embedReq({ texts: 0 }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('returns INVALID_INPUT when texts is number 42', async () => {
    const r = (await handleEmbedText(embedReq({ texts: 42 }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });

  it('returns INVALID_INPUT when texts is -0 (negative zero)', async () => {
    const r = (await handleEmbedText(embedReq({ texts: -0 }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. embed_text — `texts: ''` (empty string as scalar)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — single empty string scalar', () => {
  it('returns INVALID_INPUT when texts is single empty string (not array)', async () => {
    // '' is not null/undefined → Array.isArray('') is false → ['']
    // typeof '' === 'string' → passes type check
    // !''.trim() → !'' → true → error "texts[0] is empty"
    const r = (await handleEmbedText(embedReq({ texts: '' }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('empty');
  });

  it('returns INVALID_INPUT when texts is single tab-only string (not array)', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: '\t' }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('empty');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3–5. embed_text — response.usage with prototype-pollution keys
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response.usage with unsafe prototype-pollution keys', () => {
  it('omits usage from _meta when response.usage has __proto__ key', async () => {
    const usage = Object.create(null);
    usage['__proto__'] = 'attack';
    usage['prompt_tokens'] = 10;
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'test/model',
      usage,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    // sanitizeUpstreamUsage rejects usage with unsafe key → returns undefined
    // embed_text checks `safeUsage ? ...` → skips → no _meta.usage
    expect(r._meta.usage).toBeUndefined();
  });

  it('omits usage from _meta when response.usage has constructor key', async () => {
    const usage = Object.create(null);
    usage['constructor'] = 'attack';
    usage['cost'] = 0.01;
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'test/model',
      usage,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    // Unsafe key → sanitizer returns undefined → _meta.usage omitted
    expect(r._meta.usage).toBeUndefined();
  });

  it('loses valid keys when response.usage also has prototype key', async () => {
    const usage = Object.create(null);
    usage['prototype'] = {};
    usage['prompt_tokens'] = 100;
    usage['completion_tokens'] = 50;
    usage['total_tokens'] = 150;
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.3] }],
      model: 'test/model',
      usage,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccess;
    // Even though prompt_tokens, completion_tokens, total_tokens are valid,
    // the unsafe 'prototype' key causes sanitizer to reject the entire object
    expect(r._meta.usage).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. embed_text — number at index 0 in array
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — non-string number at index 0 in array', () => {
  it('returns INVALID_INPUT for number at texts[0]', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [42, 'valid'] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('returns INVALID_INPUT for null at texts[0]', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [null, 'valid'] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });

  it('returns INVALID_INPUT for undefined at texts[0]', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [undefined, 'valid'] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7–9. decide — response.usage with prototype-pollution keys
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — response.usage with unsafe prototype-pollution keys', () => {
  it('sets _meta.usage to undefined when response.usage has __proto__ key', async () => {
    // decide uses: response.usage ? { usage: sanitize(...) } : {}
    // If response.usage is truthy but sanitize returns undefined,
    // _meta.usage becomes explicitly undefined (vs omitted in embed_text)
    const usage = Object.create(null);
    usage['__proto__'] = 'polluted';
    usage['prompt_tokens'] = 50;
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
      usage,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    // The usage key IS present (because response.usage is truthy) but the
    // value is undefined (because sanitizer rejected the unsafe key)
    expect('usage' in r._meta).toBe(true);
    expect(r._meta.usage).toBeUndefined();
  });

  it('sets _meta.usage to undefined when response.usage has constructor key', async () => {
    const usage = Object.create(null);
    usage['constructor'] = Function;
    usage['cost'] = 0.01;
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
      usage,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r._meta.usage).toBeUndefined();
  });

  it('loses valid cost when response.usage also has prototype key', async () => {
    const usage = Object.create(null);
    usage['prototype'] = {};
    usage['cost'] = 0.001;
    usage['total_tokens'] = 200;
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.3, 0.7] } },
      usage,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    // Valid keys lost because unsafe key triggers early rejection
    expect(r._meta.usage).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. decide — summary with skipped then valid answer
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — summary line count with skipped answers', () => {
  it('produces one summary line when first answer is malformed and second is valid', async () => {
    const client = mockDecideClient({
      answers: {
        q1: 'not an object', // skipped (typeof !== 'object')
        q2: { type: 'noul', noul: 0.85 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion('Second question') } }),
      client,
    )) as DecideSuccess;
    // q1 is skipped (non-object), q2 appears
    const lines = r.content[0].text.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
    expect(lines[0]).toContain('YES');
    expect(lines[0]).toContain('85.0%');
  });

  it('produces zero summary lines when all answers are malformed', async () => {
    const client = mockDecideClient({
      answers: {
        q1: null,
        q2: 42,
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    // Both skipped — summary text is empty (join of zero lines)
    expect(r.content[0].text).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. decide — score summary with mixed non-number types
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score summary with exactly one valid among non-numbers', () => {
  it('finds the single valid value among objects, booleans, and nulls', async () => {
    const client = mockDecideClient({
      answers: {
        q1: {
          type: 'score',
          score: [{ obj: true }, false, null, 0.65, true],
        },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    // In summary loop: objects, booleans, null fail typeof === 'number'
    // Only index 3 (0.65) is valid → maxVal = 0.65, maxIdx = 3
    expect(r.content[0].text).toContain('level 4/5');
    expect(r.content[0].text).toContain('65.0%');
  });

  it('sanitizes structuredContent score: non-finite/non-number → 0', async () => {
    const client = mockDecideClient({
      answers: {
        q1: {
          type: 'score',
          score: [{ nested: 1 }, false, null, 0.65, true],
        },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    // structuredContent sanitization: non-finite → 0
    expect(r.structuredContent.answers.q1?.score).toEqual([0, 0, 0, 0.65, 0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. decide — mixed criteria sizes pass validation
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — mixed criteria sizes in a single request', () => {
  it('accepts questions with 2 entries and 100 entries simultaneously', async () => {
    const smallCriteria = { yes: 'Yes it is', no: 'No it is not' };
    const largeCriteria: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      largeCriteria[`opt_${i}`] = `Option ${i} description`;
    }

    const questions = {
      small: { type: 'noul', instructions: 'Is it raining?', criteria: smallCriteria },
      large: { type: 'choice', instructions: 'Pick one', criteria: largeCriteria },
    };
    const answers = {
      small: { type: 'noul', noul: 0.4 },
      large: { type: 'choice', choice: { opt_0: 0.5, opt_1: 0.3, opt_2: 0.2 } },
    };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(decideReq({ questions }), client)) as DecideSuccess;

    expect(r.structuredContent.answers.small).toBeDefined();
    expect(r.structuredContent.answers.large).toBeDefined();
    expect(r.content[0].text).toContain('small');
    expect(r.content[0].text).toContain('large');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. embed_text — interaction: valid batch with usage sanitization
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — successful batch with sanitized usage', () => {
  it('includes only known numeric fields in _meta.usage', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: [0.3, 0.4] },
      ],
      model: 'openai/text-embedding-3-small',
      usage: {
        prompt_tokens: 15,
        total_tokens: 15,
        custom_field: 'should be dropped',
        another_extra: { nested: true },
      },
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello', 'world'] }),
      client,
    )) as EmbedSuccess;

    // Only known numeric keys preserved
    expect(r._meta.usage).toEqual({ prompt_tokens: 15, total_tokens: 15 });
    // Custom fields stripped
    expect((r._meta.usage as Record<string, unknown>).custom_field).toBeUndefined();
    expect((r._meta.usage as Record<string, unknown>).another_extra).toBeUndefined();
  });

  it('preserves cost and duration_s alongside token counts', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'test/model',
      usage: {
        prompt_tokens: 5,
        total_tokens: 5,
        cost: 0.0001,
        duration_s: 0.5,
      },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccess;

    expect(r._meta.usage).toEqual({
      prompt_tokens: 5,
      total_tokens: 5,
      cost: 0.0001,
      duration_s: 0.5,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. decide — successful response with sanitized usage
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — successful response with sanitized usage', () => {
  it('includes only known numeric fields in _meta.usage', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.9 } },
      usage: {
        cost: 0.001,
        prompt_tokens: 100,
        extra_garbage: 'dropped',
        nested: { should: 'drop' },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    expect(r._meta.usage).toEqual({ cost: 0.001, prompt_tokens: 100 });
  });

  it('omits usage entirely when all upstream fields are non-numeric', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
      usage: {
        prompt_tokens: 'not a number',
        total_tokens: NaN,
        cost: Infinity,
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    // All values fail isFinite check → sanitizer returns undefined
    // decide: response.usage is truthy → _meta.usage exists but is undefined
    expect(r._meta.usage).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. decide — choice summary with __proto__ key filtered in sort
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice summary filters unsafe keys from sort', () => {
  it('ignores __proto__ choice entry in summary sort', async () => {
    const choice = Object.create(null);
    choice['__proto__'] = 0.99;
    choice['option_a'] = 0.8;
    choice['option_b'] = 0.2;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    // __proto__ is filtered by UNSAFE_KEYS check in the summary loop
    // option_a (0.8) should be the best
    expect(r.content[0].text).toContain('option_a');
    expect(r.content[0].text).toContain('80.0%');
    // __proto__ should not appear in summary text
    expect(r.content[0].text).not.toContain('__proto__');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. embed_text — single-text success with all metadata
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — complete metadata verification', () => {
  it('returns correct summary text format', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }],
      model: 'voyage/voyage-3',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'test embedding', model: 'voyage/voyage-3' }),
      client,
    )) as EmbedSuccess;

    // Verify exact summary format
    expect(r.content[0].text).toBe(
      'Generated 1 embedding(s) with 5 dimensions using voyage/voyage-3.',
    );
    expect(r.structuredContent.model).toBe('voyage/voyage-3');
    expect(r.structuredContent.dimensions).toBe(5);
    expect(r.structuredContent.embeddings).toHaveLength(1);
    expect(r._meta.embedding_count).toBe(1);
    expect(r._meta.dimensions).toBe(5);
    expect(r._meta.model).toBe('voyage/voyage-3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. decide — complete multi-type summary verification
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — complete summary format verification', () => {
  it('formats each answer type correctly in multi-line summary', async () => {
    const client = mockDecideClient({
      answers: {
        is_rainy: { type: 'noul', noul: 0.15 },
        best_color: { type: 'choice', choice: { red: 0.1, blue: 0.6, green: 0.3 } },
        code_quality: { type: 'score', score: [0.05, 0.1, 0.7, 0.15] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          is_rainy: noulQuestion('Is it rainy?'),
          best_color: choiceQuestion('What is the best color?'),
          code_quality: scoreQuestion('Rate code quality'),
        },
      }),
      client,
    )) as DecideSuccess;

    const lines = r.content[0].text.split('\n');
    expect(lines).toHaveLength(3);

    // noul: 0.15 < 0.5 → NO
    expect(lines[0]).toBe('is_rainy: NO (P=15.0%)');
    // choice: blue has highest probability
    expect(lines[1]).toBe('best_color: blue (P=60.0%)');
    // score: index 2 (0.7) is highest → level 3/4
    expect(lines[2]).toBe('code_quality: level 3/4 (P=70.0%)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. embed_text — dimensions not passed to API when undefined
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — dimensions parameter handling', () => {
  it('passes dimensions: undefined when not specified', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
    });
    await handleEmbedText(embedReq({ texts: 'test' }), client);
    const call = client.createEmbeddings.mock.calls[0][0];
    expect(call.dimensions).toBeUndefined();
    expect(call.model).toBe('openai/text-embedding-3-small');
    expect(call.input).toEqual(['test']);
  });

  it('passes exact dimensions value when specified', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: new Array(128).fill(0.1) }],
      model: 'test/model',
    });
    await handleEmbedText(embedReq({ texts: 'test', dimensions: 128 }), client);
    const call = client.createEmbeddings.mock.calls[0][0];
    expect(call.dimensions).toBe(128);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. decide — answer sanitization strips extra properties
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — answer allowlist strips extra properties', () => {
  it('strips extra properties from noul answer', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.8, confidence: 0.95, extra: 'leaked' },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;

    const answer = r.structuredContent.answers.q1;
    expect(answer).toBeDefined();
    expect(answer.type).toBe('noul');
    expect(answer.noul).toBe(0.8);
    expect((answer as Record<string, unknown>).confidence).toBeUndefined();
    expect((answer as Record<string, unknown>).extra).toBeUndefined();
  });

  it('strips extra properties from choice answer', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: 0.6, b: 0.4 }, reasoning: 'why' },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;

    const answer = r.structuredContent.answers.q1;
    expect(answer.type).toBe('choice');
    expect(answer.choice).toEqual({ a: 0.6, b: 0.4 });
    expect((answer as Record<string, unknown>).reasoning).toBeUndefined();
  });

  it('strips extra properties from score answer', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [0.2, 0.8], metadata: { version: 1 } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;

    const answer = r.structuredContent.answers.q1;
    expect(answer.type).toBe('score');
    expect(answer.score).toEqual([0.2, 0.8]);
    expect((answer as Record<string, unknown>).metadata).toBeUndefined();
  });
});
