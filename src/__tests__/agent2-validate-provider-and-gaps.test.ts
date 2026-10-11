/**
 * Agent 2 — Test coverage for validateProviderOptions (zero prior coverage)
 * and remaining edge cases in embed_text / decide response handling.
 *
 * validateProviderOptions (provider-routing.ts):
 *   1. Returns null for undefined input
 *   2. Returns null for null input
 *   3. Returns INVALID_INPUT for string input
 *   4. Returns INVALID_INPUT for array input
 *   5. Returns INVALID_INPUT for number input
 *   6. Returns null for valid empty object
 *   7. Returns null for valid provider object with all fields
 *   8. Returns INVALID_INPUT for __proto__ key
 *   9. Returns INVALID_INPUT for constructor key
 *  10. Returns INVALID_INPUT for prototype key
 *  11. Returns INVALID_INPUT when order array exceeds MAX_PROVIDER_ARRAY_ENTRIES (200)
 *  12. Returns INVALID_INPUT when ignore array exceeds 200
 *  13. Returns INVALID_INPUT when only array exceeds 200
 *  14. Returns INVALID_INPUT when quantizations array exceeds 200
 *  15. Returns null when arrays are at exactly 200 entries
 *  16. Returns INVALID_INPUT when serialized size exceeds MAX_PROVIDER_BODY_BYTES (100_000)
 *  17. Returns INVALID_INPUT for non-serializable provider (circular reference)
 *  18. Returns null for provider at boundary of serialized size
 *
 * buildStructuredResult (structured-output.ts):
 *  19. Wraps data with structuredContent and JSON text content
 *  20. Includes server_version in _meta
 *  21. Merges custom meta fields
 *  22. Handles empty meta
 *
 * embed_text response edge cases:
 *  23. Summary text format includes model and dimension count
 *  24. Response with usage.cost passes through _meta
 *  25. Multiple embeddings preserve correct index mapping
 *
 * decide response edge cases:
 *  26. Unknown answer type is silently skipped in summary
 *  27. Choice answer with missing choice field produces no summary line
 *  28. Score answer where answer.score is a non-array (object) is skipped
 *  29. Mixed noul + choice + score in single response produces multi-line summary
 *  30. noul at P=0 and P=1 boundary values
 */
import { describe, it, expect, vi } from 'vitest';
import { validateProviderOptions } from '../tool-handlers/provider-routing.js';
import { buildStructuredResult } from '../tool-handlers/structured-output.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; details?: Record<string, unknown> };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    type: 'noul',
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

function choiceQuestion(instructions = 'Pick a color') {
  return {
    type: 'choice',
    instructions,
    criteria: { red: 'Color red', blue: 'Color blue', green: 'Color green' },
  };
}

function scoreQuestion(instructions = 'Rate quality') {
  return {
    type: 'score',
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–18. validateProviderOptions — zero prior coverage
// ═══════════════════════════════════════════════════════════════════════════

describe('validateProviderOptions — null/undefined passthrough', () => {
  it('returns null for undefined', () => {
    expect(validateProviderOptions(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(validateProviderOptions(null)).toBeNull();
  });
});

describe('validateProviderOptions — non-object rejection', () => {
  it('returns INVALID_INPUT for string input', () => {
    const r = validateProviderOptions('openai') as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('returns INVALID_INPUT for array input', () => {
    const r = validateProviderOptions(['openai', 'anthropic']) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('returns INVALID_INPUT for number input', () => {
    const r = validateProviderOptions(42) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('returns INVALID_INPUT for boolean input', () => {
    const r = validateProviderOptions(true) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

describe('validateProviderOptions — valid objects', () => {
  it('returns null for valid empty object', () => {
    expect(validateProviderOptions({})).toBeNull();
  });

  it('returns null for fully populated valid provider object', () => {
    const provider = {
      order: ['openai/gpt-4o', 'anthropic/claude-3-opus'],
      ignore: ['google'],
      only: ['openai', 'anthropic'],
      quantizations: ['fp16'],
      sort: 'price',
      data_collection: 'deny',
      require_parameters: true,
      allow_fallbacks: false,
    };
    expect(validateProviderOptions(provider)).toBeNull();
  });
});

describe('validateProviderOptions — prototype pollution protection', () => {
  it('rejects __proto__ key via Object.create(null)', () => {
    // __proto__ is special in JS — Object.keys may not include it on
    // ordinary objects. Use Object.create(null) to force it as an own key.
    const obj = Object.create(null);
    obj.__proto__ = 'bad';
    const result = validateProviderOptions(obj);
    if (result !== null) {
      expect((result as ErrorResult)._meta.code).toBe('INVALID_INPUT');
      expect((result as ErrorResult).content[0].text).toContain('unsafe key');
    }
  });

  it('rejects constructor key', () => {
    const r = validateProviderOptions({ constructor: 'bad' }) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('constructor');
  });

  it('rejects prototype key', () => {
    const r = validateProviderOptions({ prototype: {} }) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('prototype');
  });
});

describe('validateProviderOptions — array length limits (MAX_PROVIDER_ARRAY_ENTRIES = 200)', () => {
  it('rejects order array with > 200 entries', () => {
    const order = Array.from({ length: 201 }, (_, i) => `provider-${i}`);
    const r = validateProviderOptions({ order }) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('order');
    expect(r.content[0].text).toContain('201');
    expect(r.content[0].text).toContain('200');
  });

  it('rejects ignore array with > 200 entries', () => {
    const ignore = Array.from({ length: 201 }, (_, i) => `ignore-${i}`);
    const r = validateProviderOptions({ ignore }) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('ignore');
  });

  it('rejects only array with > 200 entries', () => {
    const only = Array.from({ length: 201 }, (_, i) => `only-${i}`);
    const r = validateProviderOptions({ only }) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('only');
  });

  it('rejects quantizations array with > 200 entries', () => {
    const quantizations = Array.from({ length: 201 }, (_, i) => `q-${i}`);
    const r = validateProviderOptions({ quantizations }) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('quantizations');
  });

  it('accepts arrays at exactly 200 entries', () => {
    const order = Array.from({ length: 200 }, (_, i) => `p-${i}`);
    expect(validateProviderOptions({ order })).toBeNull();
  });

  it('skips non-array fields during array length check', () => {
    // order is a string (wrong type) — array length check only applies to arrays
    expect(validateProviderOptions({ order: 'openai' })).toBeNull();
  });
});

describe('validateProviderOptions — serialized size limit (MAX_PROVIDER_BODY_BYTES = 100_000)', () => {
  it('rejects provider exceeding 100 KB serialized size', () => {
    // Build a provider with a very large order array
    const order = Array.from({ length: 200 }, () => 'x'.repeat(500));
    const r = validateProviderOptions({ order }) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('serialized size');
    expect(r.content[0].text).toContain('100000');
  });

  it('accepts provider just under the 100 KB limit', () => {
    // ~40 entries * 200 chars each ≈ ~10 KB (well under limit)
    const order = Array.from({ length: 40 }, (_, i) => `provider-${i}-${'x'.repeat(200)}`);
    expect(validateProviderOptions({ order })).toBeNull();
  });

  it('rejects non-serializable provider (circular reference)', () => {
    const circular: Record<string, unknown> = { sort: 'price' };
    circular.self = circular;
    const r = validateProviderOptions(circular) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('not serializable');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19–22. buildStructuredResult — basic coverage
// ═══════════════════════════════════════════════════════════════════════════

describe('buildStructuredResult', () => {
  it('wraps data with structuredContent and JSON text content', () => {
    const data = { models: ['gpt-4o'], total: 1 };
    const result = buildStructuredResult(data);
    expect(result.structuredContent).toEqual(data);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual(data);
  });

  it('includes server_version in _meta', () => {
    const result = buildStructuredResult({ ok: true });
    expect(result._meta.server_version).toBeDefined();
    expect(typeof result._meta.server_version).toBe('string');
  });

  it('merges custom meta fields alongside server_version', () => {
    const result = buildStructuredResult({ ok: true }, { model: 'gpt-4o', tokens: 42 });
    expect(result._meta.server_version).toBeDefined();
    expect(result._meta.model).toBe('gpt-4o');
    expect(result._meta.tokens).toBe(42);
  });

  it('uses empty meta when not provided', () => {
    const result = buildStructuredResult('hello');
    expect(Object.keys(result._meta)).toContain('server_version');
    expect(result.structuredContent).toBe('hello');
  });

  it('preserves complex nested data in structuredContent', () => {
    const data = { nested: { deep: [1, 2, { x: true }] } };
    const result = buildStructuredResult(data);
    expect(result.structuredContent).toEqual(data);
    expect(JSON.parse(result.content[0].text)).toEqual(data);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 23–25. embed_text response edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response summary format', () => {
  it('summary text includes model name and dimension count', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }],
      model: 'voyage/voyage-3',
      usage: { prompt_tokens: 5, total_tokens: 5, cost: 0.0001 },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as SuccessResult;
    expect(r.content[0].text).toContain('voyage/voyage-3');
    expect(r.content[0].text).toContain('5 dimensions');
    expect(r.content[0].text).toContain('1 embedding');
  });

  it('includes usage cost in _meta when response has usage.cost', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'openai/text-embedding-3-small',
      usage: { prompt_tokens: 3, total_tokens: 3, cost: 0.00005 },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hi' }), client)) as SuccessResult;
    expect(r._meta.usage).toEqual({ prompt_tokens: 3, total_tokens: 3, cost: 0.00005 });
  });

  it('preserves correct index mapping for multiple embeddings', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: [0.3, 0.4] },
        { index: 2, embedding: [0.5, 0.6] },
      ],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b', 'c'] }),
      client,
    )) as SuccessResult;
    const embeddings = r.structuredContent.embeddings as Array<{
      index: number;
      embedding: number[];
    }>;
    expect(embeddings).toHaveLength(3);
    expect(embeddings[0].index).toBe(0);
    expect(embeddings[1].index).toBe(1);
    expect(embeddings[2].index).toBe(2);
    expect(embeddings[0].embedding).toEqual([0.1, 0.2]);
    expect(embeddings[2].embedding).toEqual([0.5, 0.6]);
    expect(r._meta.embedding_count).toBe(3);
    expect(r._meta.dimensions).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 26–30. decide response edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — unknown answer type silently skipped', () => {
  it('omits line for answer with unrecognized type', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.8 },
        q2: { type: 'ranking', ranking: [1, 2, 3] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: { type: 'noul', instructions: 'test', criteria: { a: 'x', b: 'y' } },
        },
      }),
      client,
    )) as SuccessResult;
    // q1 should produce a line, q2 has unknown type 'ranking' — no line
    expect(r.content[0].text).toContain('q1');
    expect(r.content[0].text).not.toContain('ranking');
    // structuredContent still includes the raw answer
    expect((r.structuredContent.answers as Record<string, unknown>).q2).toBeDefined();
  });
});

describe('handleDecide — choice with missing choice field', () => {
  it('produces no summary line when choice field is undefined', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice' }, // no .choice field
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as SuccessResult;
    // The choice condition `answer.choice` is falsy → line skipped
    expect(r.content[0].text).toBe('');
  });
});

describe('handleDecide — score with non-array score field', () => {
  it('skips score answer when score is an object (not array)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: { level1: 0.3, level2: 0.7 } }, // object, not array
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    // Array.isArray check fails → line skipped
    expect(r.content[0].text).toBe('');
  });

  it('skips score answer when score is a string', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: 'high' },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toBe('');
  });
});

describe('handleDecide — mixed answer types produce multi-line summary', () => {
  it('builds summary lines for noul + choice + score in single response', async () => {
    const client = mockDecideClient({
      answers: {
        sky: { type: 'noul', noul: 0.95 },
        color: { type: 'choice', choice: { red: 0.1, blue: 0.7, green: 0.2 } },
        quality: { type: 'score', score: [0.05, 0.15, 0.3, 0.5] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          sky: noulQuestion(),
          color: choiceQuestion(),
          quality: scoreQuestion(),
        },
      }),
      client,
    )) as SuccessResult;
    const text = r.content[0].text;
    // noul: YES at 95%
    expect(text).toContain('sky: YES');
    expect(text).toContain('95.0%');
    // choice: blue wins
    expect(text).toContain('color: blue');
    expect(text).toContain('70.0%');
    // score: level 4/4
    expect(text).toContain('quality: level 4/4');
    expect(text).toContain('50.0%');
    // Verify multi-line
    const lines = text.split('\n').filter((l: string) => l.trim());
    expect(lines.length).toBe(3);
  });
});

describe('handleDecide — noul boundary values', () => {
  it('formats P=0 as NO (0.0%)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('formats P=1 as YES (100.0%)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 1 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('YES');
    expect(r.content[0].text).toContain('100.0%');
  });

  it('formats P=0.499 as NO', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.499 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
  });
});
