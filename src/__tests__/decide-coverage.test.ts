/**
 * Additional coverage for decide — targets validation branches not
 * exercised by the primary decide.test.ts:
 *
 * - Prototype-pollution key detection in questions, criteria, and state
 * - Instructions exceeding MAX_INSTRUCTIONS_LENGTH (10_000 chars)
 * - State validation: array, null, non-object, oversized, non-serializable
 * - Non-string criteria values in score and noul/choice types
 * - Edge cases in response summary formatting
 */
import { describe, it, expect, vi } from 'vitest';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    answers: Record<string, unknown>;
  };
  _meta: Record<string, unknown>;
};

function mockApiClient(response: unknown, throws?: Error) {
  const submitDecision = vi.fn();
  if (throws) submitDecision.mockRejectedValue(throws);
  else submitDecision.mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function req(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQuestion(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

// ── Prototype pollution key detection ────────────────────────────────

describe('handleDecide — prototype pollution guards', () => {
  it('rejects __proto__ key in questions', async () => {
    // Use Object.create(null) to actually set __proto__ as own property
    const safeQuestions = Object.create(null);
    safeQuestions['__proto__'] = noulQuestion();
    const r = (await handleDecide(
      req({ questions: safeQuestions }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('__proto__');
  });

  it('rejects constructor key in questions', async () => {
    const questions = Object.create(null);
    questions['constructor'] = noulQuestion();
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('constructor');
  });

  it('rejects prototype key in questions', async () => {
    const questions = Object.create(null);
    questions['prototype'] = noulQuestion();
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('prototype');
  });

  it('rejects __proto__ key in noul/choice criteria', async () => {
    // Must use Object.create(null) + direct assignment so __proto__ becomes
    // an own property rather than triggering the prototype setter.
    const criteria = Object.create(null);
    criteria['__proto__'] = 'polluted';
    criteria['yes'] = 'yes';
    criteria['no'] = 'no';
    const questions = {
      q1: {
        type: 'noul',
        instructions: 'test',
        criteria,
      },
    };
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('rejects constructor key in choice criteria', async () => {
    const criteria = Object.create(null);
    criteria['constructor'] = 'polluted';
    criteria['a'] = 'option a';
    criteria['b'] = 'option b';
    const questions = {
      q1: {
        type: 'choice',
        instructions: 'pick one',
        criteria,
      },
    };
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('rejects __proto__ key in state', async () => {
    const state = Object.create(null);
    state['__proto__'] = 'polluted';
    state['valid'] = 'data';
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('rejects constructor key in state', async () => {
    const state = Object.create(null);
    state['constructor'] = 'polluted';
    state['context'] = 'some context';
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('rejects prototype key in state', async () => {
    const state = Object.create(null);
    state['prototype'] = 'polluted';
    state['data'] = 'value';
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });
});

// ── Instructions length limit ────────────────────────────────────────

describe('handleDecide — instructions length validation', () => {
  it('rejects instructions exceeding 10_000 characters', async () => {
    const longInstructions = 'a'.repeat(10_001);
    const questions = {
      q1: {
        type: 'noul',
        instructions: longInstructions,
        criteria: { yes: 'y', no: 'n' },
      },
    };
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('exceeds max length');
    expect(r.content[0].text).toContain('10000');
  });

  it('allows instructions at exactly 10_000 characters', async () => {
    const maxInstructions = 'b'.repeat(10_000);
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
    });
    const r = (await handleDecide(
      req({
        questions: {
          q1: {
            type: 'noul',
            instructions: maxInstructions,
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });
});

// ── State validation ─────────────────────────────────────────────────

describe('handleDecide — state validation', () => {
  it('rejects state when it is an array', async () => {
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state: [1, 2, 3] }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('rejects state when it is null', async () => {
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state: null }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('rejects state when it is a string', async () => {
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state: 'not an object' }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('rejects state when it is a number', async () => {
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state: 42 }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('rejects state exceeding MAX_STATE_BYTES (100_000 bytes)', async () => {
    const bigState = { data: 'x'.repeat(100_001) };
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state: bigState }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('serialized size');
    expect(r.content[0].text).toContain('100000');
  });

  it('allows state at exactly the byte limit', async () => {
    // JSON.stringify({ d: "x..." }) — overhead is 8 chars: {"d":"..."}
    // So 99_992 x chars + 8 overhead = 100_000 total
    const state = { d: 'x'.repeat(99_992) };
    const serialized = JSON.stringify(state);
    expect(serialized.length).toBe(100_000);
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('rejects non-serializable state (circular reference)', async () => {
    const circular: Record<string, unknown> = { a: 'value' };
    circular.self = circular;
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state: circular }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('not serializable');
  });

  it('accepts valid state object and passes it to API', async () => {
    const state = { context: 'The document is about weather', rating: 7 };
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.9 } },
    });
    await handleDecide(req({ questions: { q1: noulQuestion() }, state }), client);
    expect(client.submitDecision).toHaveBeenCalledWith(expect.objectContaining({ state }));
  });
});

// ── Non-string criteria values ───────────────────────────────────────

describe('handleDecide — criteria value type validation', () => {
  it('rejects non-string value in score criteria array', async () => {
    const questions = {
      q1: {
        type: 'score',
        instructions: 'rate quality',
        criteria: ['poor', 42, 'good'],
      },
    };
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria[1]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('rejects null value in score criteria array', async () => {
    const questions = {
      q1: {
        type: 'score',
        instructions: 'rate quality',
        criteria: [null, 'fair', 'good'],
      },
    };
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria[0]');
  });

  it('rejects boolean value in score criteria array', async () => {
    const questions = {
      q1: {
        type: 'score',
        instructions: 'rate',
        criteria: ['bad', true],
      },
    };
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria[1]');
  });

  it('rejects non-string value in noul criteria object', async () => {
    const questions = {
      q1: {
        type: 'noul',
        instructions: 'Is it raining?',
        criteria: { yes: 'It is raining', no: 123 },
      },
    };
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria.no');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('rejects null value in choice criteria object', async () => {
    const questions = {
      q1: {
        type: 'choice',
        instructions: 'pick a color',
        criteria: { red: null, blue: 'Color blue' },
      },
    };
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria.red');
  });

  it('rejects object value in choice criteria', async () => {
    const questions = {
      q1: {
        type: 'choice',
        instructions: 'pick a color',
        criteria: { red: { nested: true }, blue: 'Color blue' },
      },
    };
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria.red');
    expect(r.content[0].text).toContain('must be a string');
  });
});

// ── Response summary edge cases ──────────────────────────────────────

describe('handleDecide — response summary edge cases', () => {
  it('handles noul with P=0 correctly', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0 } },
    });
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('handles noul with P=1 correctly', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 1.0 } },
    });
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('YES');
    expect(r.content[0].text).toContain('100.0%');
  });

  it('handles score where first level is highest', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'score', score: [0.9, 0.05, 0.05] } },
    });
    const r = (await handleDecide(
      req({
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
    expect(r.content[0].text).toContain('level 1/3');
    expect(r.content[0].text).toContain('90.0%');
  });

  it('handles choice with tied probabilities (first wins via sort stability)', async () => {
    const client = mockApiClient({
      answers: {
        q1: { type: 'choice', choice: { a: 0.5, b: 0.5 } },
      },
    });
    const r = (await handleDecide(
      req({
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
    // With equal probs, sort is stable — first key ('a') wins
    expect(r.content[0].text).toContain('50.0%');
  });

  it('handles upstream 429 rate limit error', async () => {
    const err = new Error('rate limit exceeded') as Error & { status: number };
    err.status = 429;
    const client = mockApiClient(null, err);
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('handles upstream 404 model not found error', async () => {
    const err = new Error('model does not exist') as Error & { status: number };
    err.status = 404;
    const client = mockApiClient(null, err);
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
  });
});
