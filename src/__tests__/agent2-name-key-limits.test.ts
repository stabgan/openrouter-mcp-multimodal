/**
 * Agent 2 — Coverage for untested length-limit branches in decide and embed_text.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * decide.ts gaps found by static analysis:
 *  1. MAX_QUESTION_NAME_LENGTH (256) — reject question names > 256 chars
 *  2. MAX_QUESTION_NAME_LENGTH boundary — accept exactly 256 chars
 *  3. Error message truncation for long question names (.slice(0, 40))
 *  4. MAX_CRITERIA_KEY_LENGTH (256) — reject criteria keys > 256 chars (noul)
 *  5. MAX_CRITERIA_KEY_LENGTH (256) — reject criteria keys > 256 chars (choice)
 *  6. MAX_CRITERIA_KEY_LENGTH boundary — accept exactly 256 chars
 *  7. Error message truncation for long criteria keys (.slice(0, 40))
 *
 * embed_text.ts response handling gap:
 *  8. data is null (not undefined) — the `response.data ?? []` fallback
 *  9. Verify structuredContent only includes index+embedding (no extra fields)
 *
 * decide.ts response summary edge cases:
 *  10. noul with -Infinity prob defaults to 0
 *  11. score with single non-number entry among numbers
 *  12. choice answer with single entry (sort still works)
 *  13. answer entry where type is unknown (not noul/choice/score) — skipped
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
  _meta: { code: string };
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

function noulQ(instructions = 'test?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Yes', no: 'No' },
  };
}

// ---------------------------------------------------------------------------
// 1–3. MAX_QUESTION_NAME_LENGTH (256) validation
// ---------------------------------------------------------------------------

describe('handleDecide — MAX_QUESTION_NAME_LENGTH (256)', () => {
  it('rejects question name exceeding 256 characters', async () => {
    const longName = 'q'.repeat(257);
    const questions: Record<string, unknown> = { [longName]: noulQ() };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('exceeds max length');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('257');
  });

  it('accepts question name at exactly 256 characters', async () => {
    const exactName = 'q'.repeat(256);
    const questions: Record<string, unknown> = { [exactName]: noulQ() };
    const answers: Record<string, unknown> = { [exactName]: { type: 'noul', noul: 0.7 } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(decideReq({ questions }), client)) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('truncates long question name to 40 chars in error message', async () => {
    const longName = 'abcdefghij'.repeat(30); // 300 chars
    const questions: Record<string, unknown> = { [longName]: noulQ() };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    // The error message should contain the first 40 chars followed by "…"
    expect(r.content[0].text).toContain(longName.slice(0, 40));
    expect(r.content[0].text).toContain('…');
  });

  it('rejects a 500-char question name', async () => {
    const longName = 'x'.repeat(500);
    const questions: Record<string, unknown> = { [longName]: noulQ() };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('500');
  });
});

// ---------------------------------------------------------------------------
// 4–7. MAX_CRITERIA_KEY_LENGTH (256) validation for noul/choice
// ---------------------------------------------------------------------------

describe('handleDecide — MAX_CRITERIA_KEY_LENGTH (256) for noul', () => {
  it('rejects noul criteria key exceeding 256 characters', async () => {
    const longKey = 'k'.repeat(257);
    const criteria: Record<string, string> = { [longKey]: 'Yes option', no: 'No option' };
    const questions = {
      q1: { type: 'noul', instructions: 'Is it?', criteria },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria key');
    expect(r.content[0].text).toContain('exceeds max length');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('257');
  });

  it('accepts noul criteria key at exactly 256 characters', async () => {
    const exactKey = 'k'.repeat(256);
    const criteria: Record<string, string> = { [exactKey]: 'Yes', no: 'No' };
    const questions = {
      q1: { type: 'noul', instructions: 'test', criteria },
    };
    const answers = { q1: { type: 'noul', noul: 0.5 } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(decideReq({ questions }), client)) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('truncates long criteria key to 40 chars in error message', async () => {
    const longKey = 'criteriakey_'.repeat(25); // 300 chars
    const criteria: Record<string, string> = { [longKey]: 'desc', other: 'alt' };
    const questions = {
      q1: { type: 'noul', instructions: 'test', criteria },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain(longKey.slice(0, 40));
    expect(r.content[0].text).toContain('…');
  });
});

describe('handleDecide — MAX_CRITERIA_KEY_LENGTH (256) for choice', () => {
  it('rejects choice criteria key exceeding 256 characters', async () => {
    const longKey = 'c'.repeat(257);
    const criteria: Record<string, string> = { [longKey]: 'Choice A', b: 'Choice B' };
    const questions = {
      q1: { type: 'choice', instructions: 'pick one', criteria },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria key');
    expect(r.content[0].text).toContain('257');
  });

  it('accepts choice criteria key at exactly 256 characters', async () => {
    const exactKey = 'c'.repeat(256);
    const criteria: Record<string, string> = { [exactKey]: 'Option A', b: 'Option B' };
    const questions = {
      q1: { type: 'choice', instructions: 'pick', criteria },
    };
    const choice: Record<string, number> = { [exactKey]: 0.6, b: 0.4 };
    const answers = { q1: { type: 'choice', choice } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(decideReq({ questions }), client)) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 8–9. embed_text — response.data null fallback and structuredContent shape
// ---------------------------------------------------------------------------

describe('handleEmbedText — response.data null fallback', () => {
  it('returns INTERNAL when response.data is null', async () => {
    const client = mockEmbedClient({ data: null });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });
});

describe('handleEmbedText — structuredContent only includes index+embedding', () => {
  it('strips extra fields from embedding entries', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2], object: 'embedding', extra_field: true },
        { index: 1, embedding: [0.3, 0.4], object: 'embedding', extra_field: false },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as SuccessResult;
    const embeddings = (r.structuredContent as { embeddings: Array<Record<string, unknown>> })
      .embeddings;
    expect(embeddings).toHaveLength(2);
    // Each embedding should only have index + embedding fields
    for (const emb of embeddings) {
      expect(Object.keys(emb).sort()).toEqual(['embedding', 'index']);
    }
    expect(embeddings[0].index).toBe(0);
    expect(embeddings[0].embedding).toEqual([0.1, 0.2]);
    expect(embeddings[1].index).toBe(1);
    expect(embeddings[1].embedding).toEqual([0.3, 0.4]);
  });
});

// ---------------------------------------------------------------------------
// 10–13. decide — response summary edge cases
// ---------------------------------------------------------------------------

describe('handleDecide — noul with -Infinity prob', () => {
  it('treats noul=-Infinity as P=0 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -Infinity } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: 'test', criteria: { yes: 'y', no: 'n' } },
        },
      }),
      client,
    )) as SuccessResult;
    // -Infinity is not finite, so prob defaults to 0 → NO at 0.0%
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

describe('handleDecide — score with mixed number/non-number values', () => {
  it('picks the highest among number entries, ignoring non-numbers', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [0.1, 'invalid', 0.8, null] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['bad', 'ok', 'good', 'great'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    // Only indices 0 and 2 are valid numbers; 0.8 is highest → level 3/4
    expect(r.content[0].text).toContain('level 3/4');
    expect(r.content[0].text).toContain('80.0%');
  });
});

describe('handleDecide — choice with single entry in response', () => {
  it('handles choice with only one entry', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { red: 1.0 } },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick',
            criteria: { red: 'Red', blue: 'Blue' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('red');
    expect(r.content[0].text).toContain('100.0%');
  });
});

describe('handleDecide — unknown answer type in response is skipped', () => {
  it('skips answer with unknown type in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'unknown_type', data: [1, 2, 3] },
        q2: { type: 'noul', noul: 0.75 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: 'test1', criteria: { yes: 'y', no: 'n' } },
          q2: { type: 'noul', instructions: 'test2', criteria: { yes: 'y', no: 'n' } },
        },
      }),
      client,
    )) as SuccessResult;
    // q1 has type 'unknown_type' which doesn't match any branch → skipped
    // Only q2 should appear
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
    expect(lines[0]).toContain('YES');
    expect(lines[0]).toContain('75.0%');
  });
});

// ---------------------------------------------------------------------------
// 14. decide — multiple questions where only some have long names
// ---------------------------------------------------------------------------

describe('handleDecide — first valid question, second has long name', () => {
  it('validates all question names and rejects on the long one', async () => {
    const longName = 'z'.repeat(300);
    const questions: Record<string, unknown> = {
      short: noulQ(),
      [longName]: noulQ(),
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('exceeds max length');
  });
});

// ---------------------------------------------------------------------------
// 15. decide — criteria key length with multiple keys, only one exceeds
// ---------------------------------------------------------------------------

describe('handleDecide — one exceeding criteria key among valid keys', () => {
  it('rejects when one criteria key exceeds 256 while others are fine', async () => {
    const longKey = 'option_'.repeat(40); // 280 chars
    const criteria: Record<string, string> = {
      yes: 'Affirmative',
      no: 'Negative',
      [longKey]: 'Extra long option',
    };
    const questions = {
      q1: { type: 'choice', instructions: 'pick', criteria },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria key');
  });
});
