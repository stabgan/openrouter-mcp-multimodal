/**
 * Agent 2 — Final interaction coverage for embed_text, decide, and shared
 * sanitizers.  Each test targets a specific code-path interaction or value
 * combination that was not explicitly verified in the existing 120+ test
 * files (confirmed via exhaustive grep).
 *
 * NOTE: Multiple agents may be editing the repo concurrently.  This file
 * only adds tests — it does NOT modify source code.
 *
 * embed_text:
 *  1. `texts` is a single number (wrapped as [42], fails typeof on index 0)
 *  2. `texts` is an object (wrapped as [{...}], fails typeof on index 0)
 *  3. response.usage with `duration_s` alongside `prompt_tokens` — both preserved
 *  4. response.usage is numeric 0 → sanitizer returns undefined → _meta.usage omitted
 *  5. response.usage is boolean true → sanitizer returns undefined → _meta.usage omitted
 *  6. response with usage containing `cost` key at exactly 0 (falsy but valid)
 *  7. dimensions at exactly 2 (small valid number) with matching response
 *
 * decide:
 *  8. question value is literal 0 (falsy non-object) → "must be an object"
 *  9. state is boolean false → "must be a plain object"
 * 10. state is a number → "must be a plain object"
 * 11. answer with `choice: undefined` → safeChoice = {} in structuredContent
 * 12. summary for choice where `answer.choice` is a number (5) → not entered
 * 13. answer where type = 'choice' but choice is a boolean (true) → not object
 * 14. multiple answer processing: unsafe key + oversized key + valid key within cap
 * 15. noul answer where noul is exactly -Infinity → safeNoul undefined, summary 0%
 *
 * sanitizeUpstreamUsage:
 * 16. usage with `cost: 0` (zero is valid finite number) alongside unknown keys
 * 17. usage is a Map-like object (typeof 'object', not array, no known keys)
 * 18. usage with `completion_tokens` only — returns {completion_tokens: N}
 * 19. usage with `duration_s` only — returns {duration_s: N}
 * 20. usage is an empty object {} → returns undefined (no known keys)
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { sanitizeUpstreamUsage } from '../tool-handlers/sanitize-usage.js';
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

// ═══════════════════════════════════════════════════════════════════════════
// 1–2. embed_text — non-string single values wrapped then rejected
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — non-string single values', () => {
  it('rejects a single number (42) wrapped as [42] at index 0', async () => {
    const r = (await handleEmbedText(embedReq({ texts: 42 }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('rejects a single object wrapped as [{}] at index 0', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: { key: 'value' } }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3–6. embed_text — usage sanitization interactions
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — usage sanitization edge cases', () => {
  it('preserves both duration_s and prompt_tokens from upstream usage', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
      usage: { prompt_tokens: 10, duration_s: 1.5, total_tokens: 10 },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    const usage = r._meta.usage as Record<string, number>;
    expect(usage.prompt_tokens).toBe(10);
    expect(usage.duration_s).toBe(1.5);
    expect(usage.total_tokens).toBe(10);
  });

  it('omits _meta.usage when response.usage is numeric 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.2] }],
      model: 'test/model',
      usage: 0,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r._meta.usage).toBeUndefined();
  });

  it('omits _meta.usage when response.usage is boolean true', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.3] }],
      model: 'test/model',
      usage: true,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r._meta.usage).toBeUndefined();
  });

  it('preserves cost: 0 in _meta.usage (zero is a valid finite number)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.4] }],
      model: 'test/model',
      usage: { cost: 0, prompt_tokens: 5, extra_unknown: 'ignored' },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    const usage = r._meta.usage as Record<string, number>;
    expect(usage.cost).toBe(0);
    expect(usage.prompt_tokens).toBe(5);
    expect((usage as Record<string, unknown>).extra_unknown).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. embed_text — small dimension count
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — dimensions at exactly 2', () => {
  it('accepts dimensions=2 and returns matching structuredContent', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5, -0.5] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'test', dimensions: 2 }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.dimensions).toBe(2);
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.5, -0.5]);
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 2 }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8–10. decide — falsy/typed state and question values
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — falsy typed question and state values', () => {
  it('rejects question value of literal 0 (falsy non-object)', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: 0 } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('q1');
    expect(r.content[0].text).toContain('must be an object');
  });

  it('rejects state when it is boolean false', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state: false }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('rejects state when it is a number (42)', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state: 42 }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11–13. decide — choice response edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice response sanitization interactions', () => {
  it('returns empty choice map when answer.choice is undefined', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: undefined } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // answer.choice is undefined → falsy → safeChoice stays as {}
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
  });

  it('does not enter choice summary when answer.choice is a number', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: 5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // choice: 5 → typeof 5 !== 'object' → safeChoice = {}
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
    // Summary skips this entry because answer.choice (5) is truthy but
    // Object.entries(5) yields [] → entries empty → best is undefined
    // → summary shows "? (P=0.0%)"
  });

  it('returns empty choice map when answer.choice is boolean true', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: true } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // typeof true !== 'object' → choice sanitization block not entered
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. decide — combined answer processing: unsafe + long + valid keys
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — multi-answer filtering with unsafe and long keys', () => {
  it('skips unsafe and oversized answer keys, processes only valid ones within cap', async () => {
    const longKey = 'x'.repeat(257); // exceeds MAX_QUESTION_NAME_LENGTH
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.9 }; // unsafe — skipped
    answers['constructor'] = { type: 'noul', noul: 0.8 }; // unsafe — skipped
    answers[longKey] = { type: 'noul', noul: 0.7 }; // too long — skipped
    answers['valid_q'] = { type: 'noul', noul: 0.6 }; // valid — processed

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { valid_q: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // Only valid_q should appear in sanitizedAnswers
    expect(Object.keys(r.structuredContent.answers)).toEqual(['valid_q']);
    expect(r.structuredContent.answers.valid_q?.noul).toBe(0.6);
    expect(r.content[0].text).toContain('valid_q');
    expect(r.content[0].text).toContain('YES'); // 0.6 >= 0.5
    expect(r.content[0].text).toContain('60.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. decide — noul = -Infinity boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — noul = -Infinity sanitization', () => {
  it('sanitizes -Infinity noul to undefined in structuredContent, 0% in summary', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -Infinity } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // -Infinity is not finite → safeNoul = undefined
    expect(r.structuredContent.answers.q1?.noul).toBeUndefined();
    // Summary: non-finite → prob = 0 → NO 0.0%
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16–20. sanitizeUpstreamUsage — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeUpstreamUsage — edge cases', () => {
  it('preserves cost: 0 alongside unknown keys', () => {
    const result = sanitizeUpstreamUsage({
      cost: 0,
      unknown_key: 'ignored',
      another_unknown: 42,
    });
    expect(result).toEqual({ cost: 0 });
  });

  it('returns undefined for a Map-like object with no known keys', () => {
    // A plain object with only unknown keys
    const result = sanitizeUpstreamUsage({
      foo: 100,
      bar: 200,
      baz: 'text',
    });
    expect(result).toBeUndefined();
  });

  it('returns only completion_tokens when it is the sole known key', () => {
    const result = sanitizeUpstreamUsage({
      completion_tokens: 42,
      irrelevant: 'data',
    });
    expect(result).toEqual({ completion_tokens: 42 });
  });

  it('returns only duration_s when it is the sole known key', () => {
    const result = sanitizeUpstreamUsage({
      duration_s: 3.14,
      unknown: true,
    });
    expect(result).toEqual({ duration_s: 3.14 });
  });

  it('returns undefined for empty object (no known keys)', () => {
    const result = sanitizeUpstreamUsage({});
    expect(result).toBeUndefined();
  });

  it('returns undefined when usage is boolean true', () => {
    const result = sanitizeUpstreamUsage(true as unknown as Record<string, unknown>);
    expect(result).toBeUndefined();
  });

  it('returns undefined when usage is numeric 0', () => {
    const result = sanitizeUpstreamUsage(0 as unknown as Record<string, unknown>);
    expect(result).toBeUndefined();
  });

  it('returns all five known keys when all are present and finite', () => {
    const result = sanitizeUpstreamUsage({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      cost: 0.001,
      duration_s: 2.5,
    });
    expect(result).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      cost: 0.001,
      duration_s: 2.5,
    });
  });

  it('strips known keys with non-finite values (NaN, Infinity)', () => {
    const result = sanitizeUpstreamUsage({
      prompt_tokens: NaN,
      completion_tokens: Infinity,
      total_tokens: -Infinity,
      cost: 0.01,
    });
    // Only cost survives — the others are non-finite
    expect(result).toEqual({ cost: 0.01 });
  });

  it('strips known keys with non-numeric types (string, boolean)', () => {
    const result = sanitizeUpstreamUsage({
      prompt_tokens: '10',
      completion_tokens: true,
      total_tokens: null,
      cost: 0.005,
    });
    // Only cost is a valid finite number
    expect(result).toEqual({ cost: 0.005 });
  });
});
