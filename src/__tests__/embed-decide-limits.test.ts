/**
 * Coverage for untested limit-validation branches in embed_text and decide.
 *
 * embed_text:
 *  - dimensions > 65536 (upper cap)
 *  - dimensions at exactly 65536 (boundary)
 *
 * decide:
 *  - MAX_CRITERIA_ENTRIES (100) for noul/choice criteria objects
 *  - MAX_SCORE_LEVELS (100) for score criteria arrays
 *  - MAX_CRITERIA_VALUE_LENGTH (10_000) for noul/choice criteria string values
 *  - MAX_CRITERIA_VALUE_LENGTH (10_000) for score criteria string values
 *  - Boundary: exactly at each limit (should pass)
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
  _meta: { code: string };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
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

// ---------------------------------------------------------------------------
// embed_text — dimensions upper cap (65536)
// ---------------------------------------------------------------------------

describe('handleEmbedText — dimensions upper cap', () => {
  it('returns INVALID_INPUT when dimensions exceed 65536', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: 65537 }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('65537');
    expect(r.content[0].text).toContain('65536');
  });

  it('returns INVALID_INPUT when dimensions is very large', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: 1_000_000 }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('exceeds max 65536');
  });

  it('accepts dimensions at exactly 65536', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: new Array(65536).fill(0.01) }],
      model: 'openai/text-embedding-3-large',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: 65536 }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 65536 }),
    );
  });

  it('accepts dimensions at 1 (minimum)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: 1 }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// decide — MAX_CRITERIA_ENTRIES (100) for noul/choice
// ---------------------------------------------------------------------------

describe('handleDecide — criteria entry count limits', () => {
  it('returns INVALID_INPUT when noul criteria has > 100 entries', async () => {
    const criteria: Record<string, string> = {};
    for (let i = 0; i < 101; i++) {
      criteria[`opt_${i}`] = `Option ${i}`;
    }
    const questions = {
      q1: { type: 'noul', instructions: 'test question', criteria },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('101');
    expect(r.content[0].text).toContain('100');
  });

  it('returns INVALID_INPUT when choice criteria has > 100 entries', async () => {
    const criteria: Record<string, string> = {};
    for (let i = 0; i < 101; i++) {
      criteria[`choice_${i}`] = `Choice ${i}`;
    }
    const questions = {
      q1: { type: 'choice', instructions: 'pick one', criteria },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('101');
    expect(r.content[0].text).toContain('100');
  });

  it('accepts noul criteria at exactly 100 entries', async () => {
    const criteria: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      criteria[`opt_${i}`] = `Option ${i}`;
    }
    const answers: Record<string, unknown> = { q1: { type: 'noul', noul: 0.7 } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: { type: 'noul', instructions: 'test', criteria } } }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });

  it('accepts choice criteria at exactly 100 entries', async () => {
    const criteria: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      criteria[`c_${i}`] = `Choice ${i}`;
    }
    const choice: Record<string, number> = {};
    for (let i = 0; i < 100; i++) {
      choice[`c_${i}`] = 0.01;
    }
    const answers: Record<string, unknown> = { q1: { type: 'choice', choice } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: { type: 'choice', instructions: 'pick', criteria } } }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// decide — MAX_SCORE_LEVELS (100) for score criteria
// ---------------------------------------------------------------------------

describe('handleDecide — score criteria level limits', () => {
  it('returns INVALID_INPUT when score criteria has > 100 levels', async () => {
    const criteria = Array.from({ length: 101 }, (_, i) => `Level ${i}`);
    const questions = {
      q1: { type: 'score', instructions: 'rate quality', criteria },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('101');
    expect(r.content[0].text).toContain('100');
  });

  it('accepts score criteria at exactly 100 levels', async () => {
    const criteria = Array.from({ length: 100 }, (_, i) => `Level ${i}`);
    const score = new Array(100).fill(0.01);
    const answers: Record<string, unknown> = { q1: { type: 'score', score } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: { type: 'score', instructions: 'rate', criteria } } }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// decide — MAX_CRITERIA_VALUE_LENGTH (10_000) for noul/choice criteria values
// ---------------------------------------------------------------------------

describe('handleDecide — criteria value length limits (noul/choice)', () => {
  it('returns INVALID_INPUT when a noul criteria value exceeds 10_000 chars', async () => {
    const longValue = 'x'.repeat(10_001);
    const questions = {
      q1: {
        type: 'noul',
        instructions: 'Is this valid?',
        criteria: { yes: longValue, no: 'No' },
      },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria.yes');
    expect(r.content[0].text).toContain('exceeds max length');
    expect(r.content[0].text).toContain('10000');
  });

  it('returns INVALID_INPUT when a choice criteria value exceeds 10_000 chars', async () => {
    const longValue = 'y'.repeat(10_001);
    const questions = {
      q1: {
        type: 'choice',
        instructions: 'Pick one',
        criteria: { a: 'Short', b: longValue },
      },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria.b');
    expect(r.content[0].text).toContain('exceeds max length');
  });

  it('accepts noul criteria value at exactly 10_000 chars', async () => {
    const maxValue = 'z'.repeat(10_000);
    const answers: Record<string, unknown> = { q1: { type: 'noul', noul: 0.5 } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: maxValue, no: 'No' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });

  it('accepts choice criteria value at exactly 10_000 chars', async () => {
    const maxValue = 'w'.repeat(10_000);
    const answers: Record<string, unknown> = {
      q1: { type: 'choice', choice: { a: 0.6, b: 0.4 } },
    };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick',
            criteria: { a: maxValue, b: 'Short' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// decide — MAX_CRITERIA_VALUE_LENGTH (10_000) for score criteria values
// ---------------------------------------------------------------------------

describe('handleDecide — criteria value length limits (score)', () => {
  it('returns INVALID_INPUT when a score criteria value exceeds 10_000 chars', async () => {
    const longLevel = 'a'.repeat(10_001);
    const questions = {
      q1: {
        type: 'score',
        instructions: 'Rate quality',
        criteria: ['bad', longLevel, 'good'],
      },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria[1]');
    expect(r.content[0].text).toContain('exceeds max length');
    expect(r.content[0].text).toContain('10000');
  });

  it('returns INVALID_INPUT when first score criteria value exceeds limit', async () => {
    const longLevel = 'b'.repeat(10_001);
    const questions = {
      q1: {
        type: 'score',
        instructions: 'Rate it',
        criteria: [longLevel, 'good'],
      },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria[0]');
    expect(r.content[0].text).toContain('exceeds max length');
  });

  it('accepts score criteria value at exactly 10_000 chars', async () => {
    const maxLevel = 'c'.repeat(10_000);
    const answers: Record<string, unknown> = { q1: { type: 'score', score: [0.3, 0.7] } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: [maxLevel, 'good'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});
