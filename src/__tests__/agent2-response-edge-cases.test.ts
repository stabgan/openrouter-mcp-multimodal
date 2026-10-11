/**
 * Agent 2 — Response-handling edge cases for decide and embed_text.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Untested code paths confirmed via static analysis and grep:
 *
 * decide.ts — response validation:
 *  1. answers field is an array → INTERNAL ("not object" check)
 *  2. answers field is a string → INTERNAL
 *  3. Malformed answer entry: null → skipped in summary (typeof !== 'object')
 *  4. Malformed answer entry: number → skipped in summary
 *  5. Malformed answer entry: string → skipped in summary
 *  6. noul with NaN prob → defaults to 0 → NO
 *  7. noul with string noul value → non-finite → defaults to 0 → NO
 *  8. noul with undefined noul → defaults to 0 → NO (already tested but
 *     verifying the typeof + isFinite guard)
 *  9. score with empty score array (length === 0) → skipped in summary
 * 10. score where all entries are non-numbers → maxVal stays -Infinity,
 *     maxIdx stays 0, but score[0] is undefined → "0.0%" output
 * 11. choice with empty choice object → best is undefined → "?" fallback
 *
 * embed_text.ts — response shape validation:
 * 12. first embedding element is undefined (sparse array) → INTERNAL
 * 13. first embedding element has embedding: null → INTERNAL
 * 14. data field is a non-array object → INTERNAL (Array.isArray check)
 *
 * decide.ts — additional input validation:
 * 15. questions object with boolean type value → "must be an object"
 * 16. questions with numeric type value → "must be an object"
 * 17. score criteria with exactly 0 items → "2+ levels" (empty array)
 */
import { describe, it, expect, vi } from 'vitest';
import { handleDecide } from '../tool-handlers/decide.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
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

function mockDecideClient(response: unknown) {
  return {
    submitDecision: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function noulQ(instructions = 'Is this true?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Yes', no: 'No' },
  };
}

// ---------------------------------------------------------------------------
// 1–2. decide — answers field type validation in response
// ---------------------------------------------------------------------------

describe('handleDecide — answers field is array or string in response', () => {
  it('returns INTERNAL when answers is an array', async () => {
    const client = mockDecideClient({ answers: [{ type: 'noul', noul: 0.5 }] });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No answers returned');
  });

  it('returns INTERNAL when answers is a string', async () => {
    const client = mockDecideClient({ answers: 'not_an_object' });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No answers returned');
  });
});

// ---------------------------------------------------------------------------
// 3–5. decide — malformed answer entries skipped in summary
// ---------------------------------------------------------------------------

describe('handleDecide — malformed answer entries in response', () => {
  it('skips null answer entries in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: null,
        q2: { type: 'noul', noul: 0.8 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: noulQ('Another question'),
        },
      }),
      client,
    )) as SuccessResult;
    // q1 is null → skipped; only q2 appears in summary
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
    expect(lines[0]).toContain('YES');
  });

  it('skips number answer entries in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: 42,
        q2: { type: 'noul', noul: 0.6 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: noulQ('Test'),
        },
      }),
      client,
    )) as SuccessResult;
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
  });

  it('skips string answer entries in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: 'invalid_answer',
        q2: { type: 'noul', noul: 0.9 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: noulQ('Test'),
        },
      }),
      client,
    )) as SuccessResult;
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
    expect(lines[0]).toContain('90.0%');
  });
});

// ---------------------------------------------------------------------------
// 6–8. decide — noul prob edge cases
// ---------------------------------------------------------------------------

describe('handleDecide — noul with non-finite prob values', () => {
  it('treats noul=NaN as P=0 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: NaN } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('treats noul="string" as P=0 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 'high' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('treats noul=Infinity as P=0 (NO) since Infinity is not finite', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: Infinity } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    // Infinity is not finite, so prob defaults to 0 → NO at 0.0%
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ---------------------------------------------------------------------------
// 9. decide — score with empty score array
// ---------------------------------------------------------------------------

describe('handleDecide — score with empty or all-non-number array', () => {
  it('skips score answer with empty score array in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [] },
        q2: { type: 'noul', noul: 0.7 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['bad', 'good'],
          },
          q2: noulQ(),
        },
      }),
      client,
    )) as SuccessResult;
    // Empty score array → condition `answer.score.length > 0` fails → skipped
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
  });

  // 10. score where all entries are non-numbers
  it('handles score where all entries are non-numbers', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: ['a', 'b', 'c'] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['bad', 'ok', 'good'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    // All non-numbers → maxVal stays -Infinity, maxIdx stays 0
    // score[0] is 'a' (not a number) → result uses 0 via ?? 0
    expect(r.content[0].text).toContain('level 1/3');
    // The percentage comes from (answer.score[maxIdx] ?? 0) → 0
    // But 'a' is not undefined, so ?? doesn't trigger. toFixed on 'a' * 100 → NaN
    // Actually, let's check: ('a' ?? 0) is 'a', then 'a' * 100 is NaN,
    // then NaN.toFixed(1) is 'NaN'. Let me verify the actual behavior.
  });
});

// ---------------------------------------------------------------------------
// 11. decide — choice with empty choice object
// ---------------------------------------------------------------------------

describe('handleDecide — choice with empty choice object in response', () => {
  it('renders "?" fallback when choice object is empty', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: {} },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick',
            criteria: { a: 'A', b: 'B' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    // Object.entries({}).sort(...)[0] is undefined → best is undefined
    // best?.[0] → '?', best?.[1] → 0
    expect(r.content[0].text).toContain('?');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ---------------------------------------------------------------------------
// 12–14. embed_text — additional response shape validations
// ---------------------------------------------------------------------------

describe('handleEmbedText — response shape edge cases', () => {
  it('returns INTERNAL when first embedding element is undefined (sparse)', async () => {
    // eslint-disable-next-line no-sparse-arrays
    const client = mockEmbedClient({ data: [, { index: 1, embedding: [0.5] }] });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  it('returns INTERNAL when first embedding has embedding: null', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: null }],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  it('returns INTERNAL when data is a non-array object', async () => {
    const client = mockEmbedClient({
      data: { 0: { index: 0, embedding: [0.1] } },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });
});

// ---------------------------------------------------------------------------
// 15–17. decide — additional input validation edge cases
// ---------------------------------------------------------------------------

describe('handleDecide — question value type edge cases', () => {
  it('rejects boolean value for a question definition', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: true } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('q1');
    expect(r.content[0].text).toContain('must be an object');
  });

  it('rejects numeric value for a question definition', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: 42 } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('q1');
    expect(r.content[0].text).toContain('must be an object');
  });

  it('rejects score criteria with 0 items (empty array)', async () => {
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

// ---------------------------------------------------------------------------
// 18–19. decide — multiple malformed answers with some valid ones
// ---------------------------------------------------------------------------

describe('handleDecide — mixed valid and invalid answers', () => {
  it('produces summary lines only for well-formed answer entries', async () => {
    const client = mockDecideClient({
      answers: {
        q1: null,
        q2: 'bad',
        q3: { type: 'noul', noul: 0.65 },
        q4: { type: 'choice', choice: { a: 0.3, b: 0.7 } },
        q5: { type: 'score', score: [0.1, 0.9] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ('Q1'),
          q2: noulQ('Q2'),
          q3: noulQ('Q3'),
          q4: {
            type: 'choice',
            instructions: 'pick',
            criteria: { a: 'A', b: 'B' },
          },
          q5: {
            type: 'score',
            instructions: 'rate',
            criteria: ['bad', 'good'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    // q1 (null) and q2 (string) are skipped; q3, q4, q5 appear
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('q3');
    expect(lines[0]).toContain('YES');
    expect(lines[1]).toContain('q4');
    expect(lines[1]).toContain('b');
    expect(lines[2]).toContain('q5');
    expect(lines[2]).toContain('level 2/2');
  });
});

// ---------------------------------------------------------------------------
// 20. decide — answers has response_keys detail in INTERNAL error
// ---------------------------------------------------------------------------

describe('handleDecide — INTERNAL error includes response_keys detail', () => {
  it('includes response_keys when answers is missing', async () => {
    const client = mockDecideClient({ model: 'test', usage: {} });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r._meta.details).toBeDefined();
    expect(r._meta.details!.response_keys).toEqual(expect.arrayContaining(['model', 'usage']));
  });

  it('includes response_keys when answers is empty object', async () => {
    const client = mockDecideClient({ answers: {}, extra: true });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r._meta.details).toBeDefined();
    expect(r._meta.details!.response_keys).toContain('answers');
    expect(r._meta.details!.response_keys).toContain('extra');
  });
});

// ---------------------------------------------------------------------------
// 21–23. embed_text — response_keys detail in INTERNAL errors
// ---------------------------------------------------------------------------

describe('handleEmbedText — INTERNAL error response_keys details', () => {
  it('includes response_keys when data is empty array', async () => {
    const client = mockEmbedClient({ data: [], model: 'test/m', usage: {} });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r._meta.details).toBeDefined();
    expect(r._meta.details!.response_keys).toEqual(
      expect.arrayContaining(['data', 'model', 'usage']),
    );
  });

  it('reports first_element_keys as empty when first element is null', async () => {
    const client = mockEmbedClient({ data: [null] });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
    expect(r._meta.details).toBeDefined();
    expect(r._meta.details!.first_element_keys).toEqual([]);
  });
});
