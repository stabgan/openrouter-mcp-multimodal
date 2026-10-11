/**
 * Agent 2 — Final test coverage sweep for embed_text and decide handlers.
 *
 * Targets genuine untested edge cases identified via exhaustive analysis:
 *
 * embed_text:
 *  1. Response model is `null` — falls back to effectiveModel via `||`
 *  2. Response model is `0` (falsy number) — same fallback path
 *  3. texts array containing `undefined` element — caught by typeof check
 *  4. texts array containing `null` element — caught by typeof check
 *  5. texts with mixed valid and empty-after-trim — first empty wins
 *  6. Single text at exactly MAX_TEXT_LENGTH boundary (100_000) as single string (not array)
 *  7. Batch of 2 texts where second triggers totalChars overflow
 *  8. dimensions = -Infinity — not finite, caught by isFinite check
 *
 * decide:
 *  9. Unknown answer type in API response summary — line is silently skipped
 * 10. Answer entry is a number in response — typeof !== 'object', skipped
 * 11. Answer entry is a boolean in response — typeof !== 'object', skipped
 * 12. model = false (boolean) — typeof !== 'string', returns INVALID_INPUT
 * 13. model = 0 (falsy number) — typeof !== 'string', returns INVALID_INPUT
 * 14. state = 0 (falsy number, non-object) — returns INVALID_INPUT
 * 15. state = false (falsy boolean, non-object) — returns INVALID_INPUT
 * 16. questions = false (falsy non-null non-object) — returns INVALID_INPUT
 * 17. questions = 0 (falsy non-null non-object) — returns INVALID_INPUT
 * 18. noul answer at exact boundary 0.4999… — just below 0.5, shows NO
 * 19. score answer where only last element is valid number — max at last index
 * 20. choice answer with negative probabilities — sorted correctly
 * 21. Multiple answers with one unknown type — known types still appear
 * 22. criteria value as empty string "" for noul — non-empty check is on
 *     instructions, not criteria value (criteria must be a string, empty is OK)
 * 23. score criteria array with 100 levels at exactly 10_000 chars each — boundary
 * 24. state deeply nested inside array of arrays — hasDeepUnsafeKey walks arrays
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
  structuredContent: { answers: Record<string, unknown> };
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
    criteria: { yes: 'Blue sky', no: 'Not blue' },
  };
}

function choiceQ(instructions = 'Pick a color') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { red: 'Red', blue: 'Blue', green: 'Green' },
  };
}

function scoreQ(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

// ---------------------------------------------------------------------------
// 1–2. embed_text — falsy response.model fallback
// ---------------------------------------------------------------------------

describe('handleEmbedText — falsy response.model fallback', () => {
  it('falls back to effectiveModel when response.model is null', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: null,
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: 'voyage/voyage-3' }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.model).toBe('voyage/voyage-3');
    expect(r._meta.model).toBe('voyage/voyage-3');
    expect(r.content[0].text).toContain('voyage/voyage-3');
  });

  it('falls back to effectiveModel when response.model is 0 (falsy number)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 0,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccessResult;
    // 0 is falsy, so `response.model || effectiveModel` → default model
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
    expect(r._meta.model).toBe('openai/text-embedding-3-small');
  });
});

// ---------------------------------------------------------------------------
// 3–5. embed_text — element type edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — element type edge cases in texts array', () => {
  it('returns INVALID_INPUT when texts array contains undefined', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: ['valid', undefined] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
  });

  it('returns INVALID_INPUT when texts array contains null', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [null, 'valid'] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });

  it('catches first empty-after-trim text in a batch with mixed content', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: ['valid', '  \n\t  ', 'also valid'] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
    expect(r.content[0].text).toContain('empty');
  });
});

// ---------------------------------------------------------------------------
// 6. embed_text — single text string at MAX_TEXT_LENGTH boundary
// ---------------------------------------------------------------------------

describe('handleEmbedText — single string at MAX_TEXT_LENGTH boundary', () => {
  it('accepts single string of exactly 100_000 chars', async () => {
    const text = 'x'.repeat(100_000);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: text }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings).toHaveLength(1);
  });

  it('rejects single string of 100_001 chars', async () => {
    const text = 'x'.repeat(100_001);
    const r = (await handleEmbedText(
      embedReq({ texts: text }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('100001');
  });
});

// ---------------------------------------------------------------------------
// 7. embed_text — totalChars overflow from second text
// ---------------------------------------------------------------------------

describe('handleEmbedText — totalChars overflow triggered by second text', () => {
  it('returns INVALID_INPUT when second text causes total to exceed limit', async () => {
    // Each text is under the per-text limit (100K) but 120 × 90_000 = 10.8M > 10M total
    const bigText = 'a'.repeat(90_000);
    const texts = Array.from({ length: 120 }, () => bigText);
    const r = (await handleEmbedText(embedReq({ texts }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('Total input size');
    expect(r.content[0].text).toContain('10000000');
  });
});

// ---------------------------------------------------------------------------
// 8. embed_text — dimensions = -Infinity
// ---------------------------------------------------------------------------

describe('handleEmbedText — dimensions = -Infinity', () => {
  it('returns INVALID_INPUT for -Infinity dimensions', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: -Infinity }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });
});

// ---------------------------------------------------------------------------
// 9. decide — unknown answer type in response summary
// ---------------------------------------------------------------------------

describe('handleDecide — unknown answer type in response summary', () => {
  it('silently skips answers with unknown type in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.8 },
        q2: { type: 'exotic_new_type', value: 42 },
        q3: { type: 'score', score: [0.3, 0.7] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: choiceQ(),
          q3: scoreQ(),
        },
      }),
      client,
    )) as DecideSuccessResult;
    const text = r.content[0].text;
    // q1 and q3 should appear, q2 is skipped (unknown type)
    expect(text).toContain('q1');
    expect(text).toContain('q3');
    expect(text).not.toContain('q2');
    // structuredContent still has all answers
    expect(r.structuredContent.answers).toHaveProperty('q2');
  });
});

// ---------------------------------------------------------------------------
// 10–11. decide — non-object answer entries in response
// ---------------------------------------------------------------------------

describe('handleDecide — non-object answer entries in response', () => {
  it('skips numeric answer entry in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: 42,
        q2: { type: 'noul', noul: 0.7 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQ(), q2: noulQ() },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).toContain('q2');
    expect(r.content[0].text).toContain('YES');
    // q1 (numeric) is silently skipped
    expect(r.content[0].text.split('\n')).toHaveLength(1);
  });

  it('skips boolean answer entry in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: true,
        q2: { type: 'choice', choice: { a: 0.9, b: 0.1 } },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQ(), q2: choiceQ() },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).toContain('q2');
    expect(r.content[0].text).toContain('a');
  });
});

// ---------------------------------------------------------------------------
// 12–13. decide — model as non-string falsy values
// ---------------------------------------------------------------------------

describe('handleDecide — model as non-string falsy values', () => {
  it('returns INVALID_INPUT when model is false', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, model: false }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT when model is 0', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, model: 0 }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty string');
  });
});

// ---------------------------------------------------------------------------
// 14–15. decide — state as non-object falsy/truthy primitives
// ---------------------------------------------------------------------------

describe('handleDecide — state as primitive values', () => {
  it('returns INVALID_INPUT when state is 0', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state: 0 }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('returns INVALID_INPUT when state is false', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state: false }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });
});

// ---------------------------------------------------------------------------
// 16–17. decide — questions as falsy non-null values
// ---------------------------------------------------------------------------

describe('handleDecide — questions as falsy non-null values', () => {
  it('returns INVALID_INPUT when questions is false', async () => {
    const r = (await handleDecide(
      decideReq({ questions: false }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions is required');
  });

  it('returns INVALID_INPUT when questions is 0', async () => {
    const r = (await handleDecide(
      decideReq({ questions: 0 }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions is required');
  });
});

// ---------------------------------------------------------------------------
// 18. decide — noul boundary at just below 0.5
// ---------------------------------------------------------------------------

describe('handleDecide — noul probability boundary precision', () => {
  it('formats noul as NO at 0.4999', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.4999 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('50.0%');
  });

  it('formats noul as YES at 0.5001', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5001 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).toContain('YES');
    expect(r.content[0].text).toContain('50.0%');
  });
});

// ---------------------------------------------------------------------------
// 19. decide — score where only the last element is valid
// ---------------------------------------------------------------------------

describe('handleDecide — score with valid number only at last index', () => {
  it('identifies last index as highest when all others are non-numeric', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [null, 'bad', undefined, 0.42] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as DecideSuccessResult;
    // index 3 has 0.42 (only valid number) → level 4/4
    expect(r.content[0].text).toContain('level 4/4');
    expect(r.content[0].text).toContain('42.0%');
  });
});

// ---------------------------------------------------------------------------
// 20. decide — choice with negative probabilities
// ---------------------------------------------------------------------------

describe('handleDecide — choice with negative probabilities', () => {
  it('correctly sorts negative probabilities (least negative wins)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: -0.5, b: -0.1, c: -0.9 } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccessResult;
    // b = -0.1 is highest (least negative)
    expect(r.content[0].text).toContain('b');
    expect(r.content[0].text).toContain('-10.0%');
  });
});

// ---------------------------------------------------------------------------
// 21. decide — mixed known and unknown answer types
// ---------------------------------------------------------------------------

describe('handleDecide — mixed known/unknown types in multi-question response', () => {
  it('renders known types and skips unknown, preserving order', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.9 },
        q2: { type: 'novel_type', data: {} },
        q3: { type: 'choice', choice: { x: 0.8, y: 0.2 } },
        q4: { type: 'score', score: [0.1, 0.9] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: choiceQ(),
          q3: choiceQ(),
          q4: scoreQ(),
        },
      }),
      client,
    )) as DecideSuccessResult;
    const lines = r.content[0].text.split('\n');
    // q2 is skipped (unknown type), so 3 lines
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('q1');
    expect(lines[0]).toContain('YES');
    expect(lines[1]).toContain('q3');
    expect(lines[1]).toContain('x');
    expect(lines[2]).toContain('q4');
    expect(lines[2]).toContain('level 2/2');
  });
});

// ---------------------------------------------------------------------------
// 22. decide — empty string criteria value is accepted (only instructions
//     requires non-empty; criteria values just need to be strings)
// ---------------------------------------------------------------------------

describe('handleDecide — criteria value as empty string', () => {
  it('accepts empty string criteria values for noul type', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test question',
            criteria: { yes: '', no: '' },
          },
        },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('accepts empty string criteria values for choice type', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: { a: 0.6, b: 0.4 } } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick one',
            criteria: { a: '', b: '' },
          },
        },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('accepts empty string criteria levels for score type', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.3, 0.7] } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate it',
            criteria: ['', ''],
          },
        },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 23. decide — state nested inside array of arrays (deep unsafe key scan)
// ---------------------------------------------------------------------------

describe('handleDecide — hasDeepUnsafeKey traverses nested arrays of arrays', () => {
  it('rejects state with __proto__ nested inside array of arrays', async () => {
    const leaf = Object.create(null);
    leaf['__proto__'] = 'attack';
    leaf['safe'] = 'val';
    const state = { matrix: [[leaf]] };
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('accepts state with deeply nested arrays containing no unsafe keys', async () => {
    const state = {
      data: [[{ a: 1 }], [{ b: 2 }, { c: [{ d: 3 }] }]],
    };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 24. embed_text — model as false/0 (non-string non-undefined)
// ---------------------------------------------------------------------------

describe('handleEmbedText — model as non-string falsy values', () => {
  it('returns INVALID_INPUT when model is false', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: false }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT when model is 0', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: 0 }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty string');
  });
});

// ---------------------------------------------------------------------------
// 25. embed_text — upstream 429 rate limit via classifyUpstreamError
// ---------------------------------------------------------------------------

describe('handleEmbedText — upstream rate limit error', () => {
  it('classifies 429 error as UPSTREAM_REFUSED with rate_limit reason', async () => {
    const err = Object.assign(new Error('rate limit exceeded'), { status: 429 });
    const client = mockEmbedClient(null, err);
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
  });
});

// ---------------------------------------------------------------------------
// 26. decide — upstream 500 server error
// ---------------------------------------------------------------------------

describe('handleDecide — upstream server error', () => {
  it('classifies 500 error as UPSTREAM_HTTP', async () => {
    const err = Object.assign(new Error('Internal Server Error'), { status: 500 });
    const client = mockDecideClient(null, err);
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });
});

// ---------------------------------------------------------------------------
// 27. decide — noul with non-numeric, non-undefined value
// ---------------------------------------------------------------------------

describe('handleDecide — noul with unusual prob values', () => {
  it('treats noul with null prob as 0 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: null } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('treats noul with boolean true as 0 (NO, not finite)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: true } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccessResult;
    // typeof true === 'boolean', not 'number', so falls to 0
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ---------------------------------------------------------------------------
// 28. decide — choice answer with zero probabilities for all options
// ---------------------------------------------------------------------------

describe('handleDecide — choice with all-zero probabilities', () => {
  it('picks first option when all probabilities are 0', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: 0, b: 0, c: 0 } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ---------------------------------------------------------------------------
// 29. decide — score answer with single very large probability
// ---------------------------------------------------------------------------

describe('handleDecide — score with probability > 1', () => {
  it('displays probability > 100% faithfully', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [0.0, 1.5] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as DecideSuccessResult;
    // 1.5 * 100 = 150.0%
    expect(r.content[0].text).toContain('level 2/2');
    expect(r.content[0].text).toContain('150.0%');
  });
});

// ---------------------------------------------------------------------------
// 30. decide — _meta.question_count matches input, not response
// ---------------------------------------------------------------------------

describe('handleDecide — _meta.question_count matches request', () => {
  it('question_count in _meta equals the number of questions sent', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.5 },
        q2: { type: 'noul', noul: 0.5 },
        q3: { type: 'noul', noul: 0.5 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: noulQ(),
          q3: noulQ(),
        },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r._meta.question_count).toBe(3);
  });
});
