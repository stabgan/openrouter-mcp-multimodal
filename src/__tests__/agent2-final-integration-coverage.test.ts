/**
 * Final integration-level coverage for embed_text and decide handlers.
 *
 * Targets gaps identified after auditing 105 existing test files:
 *
 * embed_text:
 *  1. response.data is null → null-coalescing to [] → INTERNAL error
 *  2. Usage with prototype-pollution key in upstream response → _meta.usage omitted
 *  3. Usage with non-numeric values (string tokens) → stripped by sanitizer
 *  4. Usage with only unknown keys → _meta.usage omitted
 *  5. Batch embeddings with mixed sanitization (invalid indices, NaN values, Infinity)
 *  6. Single embedding with all non-finite values → all mapped to 0
 *  7. response.model is boolean → safeResponseModel = undefined → displayModel = effectiveModel
 *
 * decide:
 *  8. answer.type is undefined → hits default branch, only { type: undefined } in structuredContent
 *  9. state is false → typeof false !== 'object' → INVALID_INPUT
 * 10. state is 0 → typeof 0 !== 'object' → INVALID_INPUT
 * 11. state is a boolean true → typeof true !== 'object' → INVALID_INPUT
 * 12. Usage with unsafe key in upstream decide response → _meta.usage omitted
 * 13. Usage with duration_s and cost fields → included in sanitized _meta.usage
 * 14. Choice answer where choice is an array → falsy typeof check → safeChoice = {}
 * 15. Score answer where all values are strings → all mapped to 0, maxVal = 0 at index 0
 * 16. Multiple answers mixing sanitized noul, choice with non-object, score with NaN
 * 17. Noul answer with noul = -0 → finite, structuredContent.noul = -0, summary "NO" at 0%
 * 18. Score answer with single Infinity value among NaN → maxVal = Infinity, displayed faithfully
 * 19. Arguments is null (not undefined) → fallback to empty object
 * 20. embed_text arguments is null → fallback to empty object → texts undefined → error
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    answers: Record<string, { type: string; [key: string]: unknown }>;
  };
  _meta: Record<string, unknown>;
};

function mockEmbedClient(response: unknown, throws?: Error) {
  const createEmbeddings = vi.fn();
  if (throws) createEmbeddings.mockRejectedValue(throws);
  else createEmbeddings.mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown, throws?: Error) {
  const submitDecision = vi.fn();
  if (throws) submitDecision.mockRejectedValue(throws);
  else submitDecision.mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
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
    criteria: { yes: 'Yes', no: 'No' },
  };
}

function choiceQ(instructions = 'Pick one') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { a: 'Option A', b: 'Option B' },
  };
}

function scoreQ(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['bad', 'ok', 'good'],
  };
}

// ---------------------------------------------------------------------------
// embed_text — upstream response edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — upstream response data null-coalescing', () => {
  it('returns INTERNAL when response.data is null (null-coalesces to empty array)', async () => {
    const client = mockEmbedClient({ data: null, model: 'openai/text-embedding-3-small' });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });
});

describe('handleEmbedText — usage sanitization in handler context', () => {
  it('omits usage from _meta when upstream usage has __proto__ key', async () => {
    const usage = Object.create(null);
    usage['__proto__'] = 'attack';
    usage['prompt_tokens'] = 10;
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
      usage,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    // sanitizeUpstreamUsage returns undefined when __proto__ is present
    expect(r._meta.usage).toBeUndefined();
  });

  it('strips non-numeric token values from usage in _meta', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'openai/text-embedding-3-small',
      usage: { prompt_tokens: 'not a number', total_tokens: 15, extra_field: 'ignored' },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    const usage = r._meta.usage as Record<string, unknown>;
    expect(usage).toBeDefined();
    // Only total_tokens passes (numeric + finite + known key)
    expect(usage.total_tokens).toBe(15);
    // prompt_tokens was a string → stripped
    expect(usage.prompt_tokens).toBeUndefined();
    // extra_field is not a known key → stripped
    expect(usage).not.toHaveProperty('extra_field');
  });

  it('omits usage from _meta when all usage values are non-numeric', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
      usage: { prompt_tokens: NaN, total_tokens: Infinity, cost: 'free' },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccess;
    expect(r._meta.usage).toBeUndefined();
  });

  it('omits usage from _meta when upstream usage has only unknown keys', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
      usage: { custom_metric: 42, latency_ms: 100 },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccess;
    expect(r._meta.usage).toBeUndefined();
  });
});

describe('handleEmbedText — batch embedding sanitization with mixed invalid values', () => {
  it('sanitizes batch with invalid indices and non-finite embedding values', async () => {
    const client = mockEmbedClient({
      data: [
        { index: -1, embedding: [0.1, NaN, 0.3] }, // negative index → falls back to 0
        { index: 'two', embedding: [Infinity, 0.2, -Infinity] }, // string index → falls back to 1
        { index: 1.5, embedding: [0.4, 'bad', null] }, // float index → falls back to 2
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b', 'c'] }), client)) as EmbedSuccess;

    expect(r.structuredContent.embeddings).toHaveLength(3);

    // First: index -1 → sanitized to 0; embedding [0.1, 0, 0.3] (NaN → 0)
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0, 0.3]);

    // Second: index 'two' → sanitized to 1; embedding [0, 0.2, 0] (Infinity/-Infinity → 0)
    expect(r.structuredContent.embeddings[1].index).toBe(1);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([0, 0.2, 0]);

    // Third: index 1.5 → sanitized to 2; embedding [0.4, 0, 0] (string/null → 0)
    expect(r.structuredContent.embeddings[2].index).toBe(2);
    expect(r.structuredContent.embeddings[2].embedding).toEqual([0.4, 0, 0]);
  });

  it('maps all non-finite embedding values to 0 in a single embedding', async () => {
    const client = mockEmbedClient({
      data: [
        {
          index: 0,
          embedding: [NaN, Infinity, -Infinity, 'text', null, undefined, true, {}, [], 0.5],
        },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccess;
    // Only the last value (0.5) is a finite number
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5]);
  });
});

describe('handleEmbedText — response.model is boolean', () => {
  it('falls back to effectiveModel when response.model is true', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: true,
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'test', model: 'custom/model' }),
      client,
    )) as EmbedSuccess;
    // typeof true !== 'string' → safeResponseModel = undefined → displayModel = effectiveModel
    expect(r.structuredContent.model).toBe('custom/model');
    expect(r._meta.model).toBe('custom/model');
  });
});

describe('handleEmbedText — arguments null fallback', () => {
  it('handles null arguments by falling back to empty object', async () => {
    const r = (await handleEmbedText(
      { params: { arguments: null as unknown as { texts: string } } },
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts is required');
  });
});

// ---------------------------------------------------------------------------
// decide — state validation edge cases
// ---------------------------------------------------------------------------

describe('handleDecide — state as non-object primitive types', () => {
  it('rejects state = false (typeof boolean !== object)', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state: false }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('rejects state = 0 (typeof number !== object)', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state: 0 }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('rejects state = true (typeof boolean !== object)', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state: true }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });
});

// ---------------------------------------------------------------------------
// decide — usage sanitization in handler context
// ---------------------------------------------------------------------------

describe('handleDecide — usage sanitization in handler context', () => {
  it('omits usage from _meta when upstream usage has constructor key', async () => {
    const usage = Object.create(null);
    usage['constructor'] = 'Function';
    usage['cost'] = 0.001;
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
      usage,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccess;
    // sanitizeUpstreamUsage returns undefined when unsafe keys present
    expect(r._meta.usage).toBeUndefined();
  });

  it('includes duration_s and cost in sanitized usage', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
      usage: { cost: 0.002, duration_s: 1.5, prompt_tokens: 20 },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccess;
    const usage = r._meta.usage as Record<string, number>;
    expect(usage).toBeDefined();
    expect(usage.cost).toBe(0.002);
    expect(usage.duration_s).toBe(1.5);
    expect(usage.prompt_tokens).toBe(20);
  });

  it('omits usage when all values are NaN or Infinity', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
      usage: { cost: NaN, prompt_tokens: Infinity },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccess;
    expect(r._meta.usage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// decide — response sanitization edge cases
// ---------------------------------------------------------------------------

describe('handleDecide — answer with undefined type hits default branch', () => {
  it('includes only { type: undefined } in structuredContent for undefined-type answer', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: undefined, noul: 0.8 },
        q2: { type: 'noul', noul: 0.9 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ(), q2: noulQ() } }),
      client,
    )) as DecideSuccess;
    // q1 has undefined type → default branch → only type field preserved
    expect(r.structuredContent.answers.q1).toEqual({ type: undefined });
    // q1's noul field is NOT in structuredContent (stripped by allowlist)
    expect(r.structuredContent.answers.q1).not.toHaveProperty('noul');
    // q2 is normal
    expect(r.structuredContent.answers.q2.type).toBe('noul');
    expect(r.structuredContent.answers.q2.noul).toBe(0.9);
  });
});

describe('handleDecide — choice answer where choice is an array', () => {
  it('treats array choice as truthy object but entries are index-value pairs', async () => {
    // Array IS typeof 'object' and truthy, so it enters the loop.
    // Object.entries([0.5, 0.3]) → [['0', 0.5], ['1', 0.3]]
    // Keys '0' and '1' are not in UNSAFE_KEYS, values are finite numbers → included
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: [0.5, 0.3] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccess;
    const choice = r.structuredContent.answers.q1.choice as Record<string, number>;
    // Array entries become { '0': 0.5, '1': 0.3 }
    expect(choice['0']).toBe(0.5);
    expect(choice['1']).toBe(0.3);
  });
});

describe('handleDecide — score answer where all values are non-numeric strings', () => {
  it('maps all string values to 0, maxVal stays at first valid 0, shows level 1', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: ['high', 'low', 'medium'] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as DecideSuccess;
    // In structuredContent, all string values are mapped to 0
    const score = r.structuredContent.answers.q1.score as number[];
    expect(score).toEqual([0, 0, 0]);
    // In summary, none pass typeof === 'number' check, so maxVal = -Infinity
    // displayScore = maxVal === -Infinity ? 0 : maxVal → 0
    expect(r.content[0].text).toContain('0.0%');
  });
});

describe('handleDecide — noul answer with noul = -0', () => {
  it('preserves -0 in structuredContent (finite number) and shows NO at 0% in summary', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccess;
    // -0 is a finite number → preserved in structuredContent
    expect(Object.is(r.structuredContent.answers.q1.noul, -0)).toBe(true);
    // -0 >= 0.5 is false → NO
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

describe('handleDecide — score with single Infinity among NaN values', () => {
  it('finds Infinity as max value and displays it faithfully', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [NaN, Infinity, NaN] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as DecideSuccess;
    // In the summary loop, Infinity passes typeof === 'number' check
    // (Infinity IS typeof number), so maxVal = Infinity at index 1
    // displayScore = Infinity (not -Infinity), displays as "Infinity%"
    // Note: structuredContent maps Infinity → 0 (via Number.isFinite check)
    const score = r.structuredContent.answers.q1.score as number[];
    expect(score).toEqual([0, 0, 0]); // NaN and Infinity both map to 0
    // But the summary uses the raw answer.score, not sanitized
    expect(r.content[0].text).toContain('level 2/3');
  });
});

describe('handleDecide — multiple answers with mixed sanitization', () => {
  it('correctly sanitizes each answer type independently', async () => {
    const client = mockDecideClient({
      answers: {
        n1: { type: 'noul', noul: NaN, extra: 'leaked' },
        c1: { type: 'choice', choice: false }, // falsy → safeChoice = {}
        s1: { type: 'score', score: { 0: 0.5 } }, // non-array → safeScore = undefined
        u1: { type: 'custom_type', data: 'anything' }, // unknown type → only { type }
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          n1: noulQ(),
          c1: choiceQ(),
          s1: scoreQ(),
          u1: noulQ(),
        },
      }),
      client,
    )) as DecideSuccess;

    const answers = r.structuredContent.answers;

    // noul with NaN → noul is undefined, extra field stripped
    expect(answers.n1).toEqual({ type: 'noul', noul: undefined });
    expect(answers.n1).not.toHaveProperty('extra');

    // choice with falsy value → safeChoice = {}
    expect(answers.c1).toEqual({ type: 'choice', choice: {} });

    // score with non-array → safeScore = undefined
    expect(answers.s1).toEqual({ type: 'score', score: undefined });

    // unknown type → only type field preserved
    expect(answers.u1).toEqual({ type: 'custom_type' });
    expect(answers.u1).not.toHaveProperty('data');
  });
});

describe('handleDecide — arguments null fallback', () => {
  it('handles null arguments by falling back to empty object', async () => {
    const r = (await handleDecide(
      {
        params: {
          arguments: null as unknown as {
            questions: Record<string, unknown>;
          },
        },
      },
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions is required');
  });
});

// ---------------------------------------------------------------------------
// decide — answer field type edge cases in structuredContent
// ---------------------------------------------------------------------------

describe('handleDecide — noul structuredContent vs summary divergence', () => {
  it('structuredContent has noul=undefined while summary shows P=0% for NaN noul', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: NaN } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccess;

    // structuredContent uses safeNoul = undefined (NaN is not finite)
    expect(r.structuredContent.answers.q1.noul).toBeUndefined();
    // summary uses prob = 0 (NaN is not finite number → default to 0)
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('structuredContent has noul=undefined while summary shows P=0% for Infinity noul', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: Infinity } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccess;

    expect(r.structuredContent.answers.q1.noul).toBeUndefined();
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

describe('handleDecide — choice structuredContent when choice is non-object types', () => {
  it('produces empty safeChoice when choice is a number', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: 42 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccess;
    // 42 is truthy but typeof 42 !== 'object' → condition fails → safeChoice = {}
    expect(r.structuredContent.answers.q1.choice).toEqual({});
  });

  it('produces empty safeChoice when choice is a string', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: 'invalid' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers.q1.choice).toEqual({});
  });
});

describe('handleDecide — score structuredContent when score is string', () => {
  it('produces undefined safeScore when score is a string', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: 'high' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as DecideSuccess;
    // 'high' is not an array → safeScore stays undefined
    expect(r.structuredContent.answers.q1.score).toBeUndefined();
  });
});
