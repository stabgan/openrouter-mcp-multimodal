/**
 * Agent 2 — Confirmed untested edge cases for embed_text and decide handlers.
 *
 * Identified by exhaustive grep of all src/__tests__/ files. Each test below
 * exercises a code path that no existing test file covers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * embed_text — untested type-specific validation:
 *  1. dimensions: null (passes !== undefined, hits typeof !== 'number')
 *  2. model: null combined with valid texts (passes !== undefined check)
 *
 * decide — untested falsy/type-mismatch inputs:
 *  3. instructions: 0 (falsy number, typeof !== 'string')
 *  4. instructions: false (boolean, typeof !== 'string')
 *  5. instructions: null (null, typeof !== 'string')
 *  6. model: null (passes !== undefined check for decide)
 *  7. criteria: 42 (truthy number) for noul type — passes !criteria, fails typeof
 *  8. criteria: 'text' (truthy string) for noul type — passes !criteria, fails typeof
 *  9. criteria: true (truthy boolean) for noul type — passes !criteria, fails typeof
 * 10. criteria: 42 (truthy number) for choice type — same path as noul
 * 11. score criteria: 'text' (string, not array) — passes !criteria, fails isArray
 * 12. score criteria: 42 (number, not array) — same path
 * 13. score criteria: {} (object, not array) — fails isArray
 * 14. score criteria: true (boolean, not array) — fails isArray
 *
 * decide — response summary edge cases:
 * 15. noul: null (typeof null !== 'number', defaults to 0)
 * 16. noul: true (typeof boolean !== 'number', defaults to 0)
 * 17. noul: {} (typeof object !== 'number', defaults to 0)
 * 18. choice with Infinity values (filtered by Number.isFinite)
 * 19. answer entry that is 0 (falsy non-object) — skipped
 * 20. answer entry that is '' (empty string, non-object) — skipped
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

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

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  return {
    submitDecision: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQ(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Blue', no: 'Not blue' },
  };
}

function choiceQ(instructions = 'Pick a color') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { red: 'Red', blue: 'Blue', green: 'Green' },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. embed_text — dimensions: null
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — dimensions: null', () => {
  it('returns INVALID_INPUT for dimensions: null (typeof null !== number)', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: null }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. embed_text — model: null (already tested in agent2-handler-coverage-r2)
//    Re-verifying here for completeness of the type matrix.
// ═══════════════════════════════════════════════════════════════════════════

// Skipped — confirmed covered in agent2-handler-coverage-r2.test.ts

// ═══════════════════════════════════════════════════════════════════════════
// 3–5. decide — instructions as falsy non-string types
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — instructions type mismatches', () => {
  it('returns INVALID_INPUT when instructions is 0 (falsy number)', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: 0, criteria: { yes: 'y', no: 'n' } },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('instructions');
    expect(r.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT when instructions is false (boolean)', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'choice', instructions: false, criteria: { a: 'A', b: 'B' } },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('instructions');
  });

  it('returns INVALID_INPUT when instructions is null', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: null, criteria: { yes: 'y', no: 'n' } },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('instructions');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. decide — model: null
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — model: null', () => {
  it('returns INVALID_INPUT when model is null (passes !== undefined check)', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, model: null }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7–10. decide — criteria as truthy non-object types for noul/choice
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — criteria type mismatches for noul/choice', () => {
  it('returns INVALID_INPUT when noul criteria is a number', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: 'test', criteria: 42 },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('object with 2+ options');
  });

  it('returns INVALID_INPUT when noul criteria is a string', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: 'test', criteria: 'yes,no' },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('object with 2+ options');
  });

  it('returns INVALID_INPUT when noul criteria is true (boolean)', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: 'test', criteria: true },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('object with 2+ options');
  });

  it('returns INVALID_INPUT when choice criteria is a number', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'choice', instructions: 'pick one', criteria: 99 },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('object with 2+ options');
    expect(r.content[0].text).toContain('choice');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11–14. decide — score criteria as non-array truthy types
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score criteria type mismatches', () => {
  it('returns INVALID_INPUT when score criteria is a string', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: 'poor,fair,good' },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('array of 2+ levels');
  });

  it('returns INVALID_INPUT when score criteria is a number', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: 5 },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('array of 2+ levels');
  });

  it('returns INVALID_INPUT when score criteria is a plain object', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: { poor: 'Bad', good: 'Great' },
          },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('array of 2+ levels');
  });

  it('returns INVALID_INPUT when score criteria is a boolean', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: true },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('array of 2+ levels');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15–17. decide — noul response with non-number prob types
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — noul prob as non-number types in response', () => {
  it('treats noul: null as P=0 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: null } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('treats noul: true (boolean) as P=0 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: true } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('treats noul: {} (object) as P=0 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: {} } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. decide — choice with Infinity values in response
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice response with non-finite values', () => {
  it('filters Infinity and NaN from choice probabilities', async () => {
    const client = mockDecideClient({
      answers: {
        q1: {
          type: 'choice',
          choice: { opt_a: Infinity, opt_b: NaN, opt_c: 0.6 },
        },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as SuccessResult;
    // Infinity and NaN are filtered — only opt_c (0.6) remains
    expect(r.content[0].text).toContain('opt_c');
    expect(r.content[0].text).toContain('60.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19–20. decide — falsy non-object answer entries in response
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — falsy answer entries skipped in summary', () => {
  it('skips answer entry that is 0 (falsy non-object)', async () => {
    const client = mockDecideClient({
      answers: { q1: 0, q2: { type: 'noul', noul: 0.8 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ(), q2: noulQ() } }),
      client,
    )) as SuccessResult;
    // q1 is 0 (falsy) → skipped by `if (!answer || typeof answer !== 'object') continue`
    // Only q2 should appear
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
    expect(lines[0]).toContain('YES');
  });

  it('skips answer entry that is empty string (falsy non-object)', async () => {
    const client = mockDecideClient({
      answers: { q1: '', q2: { type: 'noul', noul: 0.9 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ(), q2: noulQ() } }),
      client,
    )) as SuccessResult;
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
  });

  it('skips answer entry that is false (falsy non-object)', async () => {
    const client = mockDecideClient({
      answers: { q1: false, q2: { type: 'choice', choice: { a: 0.7, b: 0.3 } } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ(), q2: choiceQ() } }),
      client,
    )) as SuccessResult;
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
    expect(lines[0]).toContain('a');
  });
});
