import { describe, it, expect, vi } from 'vitest';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { SERVER_VERSION } from '../version.js';

type SuccessResult = {
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

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
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

describe('handleDecide', () => {
  // ── Validation: questions ──────────────────────────────────────────

  it('returns INVALID_INPUT when questions is undefined', async () => {
    const r = (await handleDecide(req({}), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions is required');
  });

  it('returns INVALID_INPUT when questions is null', async () => {
    const r = (await handleDecide(req({ questions: null }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when questions is an array', async () => {
    const r = (await handleDecide(req({ questions: [] }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('must be an object');
  });

  it('returns INVALID_INPUT when questions is a string', async () => {
    const r = (await handleDecide(
      req({ questions: 'not an object' }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT for empty questions object', async () => {
    const r = (await handleDecide(req({ questions: {} }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('empty');
  });

  it('returns INVALID_INPUT when questions exceed MAX_QUESTIONS (50)', async () => {
    const questions: Record<string, unknown> = {};
    for (let i = 0; i < 51; i++) {
      questions[`q${i}`] = noulQuestion();
    }
    const r = (await handleDecide(req({ questions }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('51');
    expect(r.content[0].text).toContain('50');
  });

  it('allows exactly 50 questions', async () => {
    const questions: Record<string, unknown> = {};
    const answers: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      questions[`q${i}`] = noulQuestion();
      answers[`q${i}`] = { type: 'noul', noul: 0.7 };
    }
    const client = mockApiClient({ answers });
    const r = (await handleDecide(req({ questions }), client)) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  // ── Validation: question definition shape ──────────────────────────

  it('returns INVALID_INPUT when a question is not an object', async () => {
    const r = (await handleDecide(
      req({ questions: { q1: 'not an object' } }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('q1');
    expect(r.content[0].text).toContain('must be an object');
  });

  it('returns INVALID_INPUT when a question is null', async () => {
    const r = (await handleDecide(
      req({ questions: { q1: null } }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('q1');
  });

  // ── Validation: question type ──────────────────────────────────────

  it('returns INVALID_INPUT for invalid question type', async () => {
    const r = (await handleDecide(
      req({
        questions: {
          q1: { type: 'boolean', instructions: 'test', criteria: { a: '1', b: '2' } },
        },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('noul, choice, score');
    expect(r.content[0].text).toContain('boolean');
  });

  it('returns INVALID_INPUT for missing question type', async () => {
    const r = (await handleDecide(
      req({
        questions: {
          q1: { instructions: 'test', criteria: { a: '1', b: '2' } },
        },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('noul, choice, score');
  });

  it('accepts all three valid types: noul, choice, score', async () => {
    const questions = {
      q1: noulQuestion(),
      q2: choiceQuestion(),
      q3: scoreQuestion(),
    };
    const client = mockApiClient({
      answers: {
        q1: { type: 'noul', noul: 0.8 },
        q2: { type: 'choice', choice: { red: 0.1, blue: 0.7, green: 0.2 } },
        q3: { type: 'score', score: [0.1, 0.2, 0.5, 0.2] },
      },
    });
    const r = (await handleDecide(req({ questions }), client)) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  // ── Validation: instructions ───────────────────────────────────────

  it('returns INVALID_INPUT for missing instructions', async () => {
    const r = (await handleDecide(
      req({
        questions: {
          q1: { type: 'noul', criteria: { yes: '1', no: '2' } },
        },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('instructions');
    expect(r.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT for empty instructions', async () => {
    const r = (await handleDecide(
      req({
        questions: {
          q1: { type: 'noul', instructions: '', criteria: { yes: '1', no: '2' } },
        },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('instructions');
  });

  it('returns INVALID_INPUT for whitespace-only instructions', async () => {
    const r = (await handleDecide(
      req({
        questions: {
          q1: { type: 'noul', instructions: '   ', criteria: { yes: '1', no: '2' } },
        },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('instructions');
  });

  it('returns INVALID_INPUT for non-string instructions', async () => {
    const r = (await handleDecide(
      req({
        questions: {
          q1: { type: 'noul', instructions: 42, criteria: { yes: '1', no: '2' } },
        },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('instructions');
  });

  // ── Validation: criteria ───────────────────────────────────────────

  it('returns INVALID_INPUT for missing criteria', async () => {
    const r = (await handleDecide(
      req({
        questions: { q1: { type: 'noul', instructions: 'test' } },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('criteria');
  });

  it('returns INVALID_INPUT for score type with non-array criteria', async () => {
    const r = (await handleDecide(
      req({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: { a: '1', b: '2' } },
        },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('array of 2+ levels');
  });

  it('returns INVALID_INPUT for score type with only 1 level', async () => {
    const r = (await handleDecide(
      req({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: ['only one'] },
        },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('2+ levels');
  });

  it('accepts score type with exactly 2 levels', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'score', score: [0.4, 0.6] } },
    });
    const r = (await handleDecide(
      req({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: ['bad', 'good'] },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('returns INVALID_INPUT for noul type with array criteria', async () => {
    const r = (await handleDecide(
      req({
        questions: {
          q1: { type: 'noul', instructions: 'test', criteria: ['yes', 'no'] },
        },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('object with 2+ options');
  });

  it('returns INVALID_INPUT for noul type with only 1 option', async () => {
    const r = (await handleDecide(
      req({
        questions: {
          q1: { type: 'noul', instructions: 'test', criteria: { only: 'one' } },
        },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('2+ options');
  });

  it('returns INVALID_INPUT for choice type with only 1 option', async () => {
    const r = (await handleDecide(
      req({
        questions: {
          q1: { type: 'choice', instructions: 'pick', criteria: { only: 'one' } },
        },
      }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('2+ options');
  });

  // ── Validation: model ──────────────────────────────────────────────

  it('returns INVALID_INPUT for empty model string', async () => {
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, model: '' }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT for whitespace-only model', async () => {
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, model: '   ' }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT for non-string model', async () => {
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, model: 123 }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
  });

  // ── Default model ──────────────────────────────────────────────────

  it('uses default model typesafe/jev-1.13 when none specified', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    await handleDecide(req({ questions: { q1: noulQuestion() } }), client);
    expect(client.submitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'typesafe/jev-1.13' }),
    );
  });

  it('trims model before passing to the API', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    await handleDecide(
      req({ questions: { q1: noulQuestion() }, model: '  upstage/solar-decide  ' }),
      client,
    );
    expect(client.submitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'upstage/solar-decide' }),
    );
  });

  // ── API call shape ─────────────────────────────────────────────────

  it('passes questions, state, and model to the API', async () => {
    const questions = { q1: noulQuestion() };
    const state = { context: 'some context' };
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.9 } },
    });
    await handleDecide(req({ questions, state, model: 'upstage/solar-decide' }), client);
    expect(client.submitDecision).toHaveBeenCalledWith({
      model: 'upstage/solar-decide',
      questions,
      state,
    });
  });

  // ── Successful responses: noul ─────────────────────────────────────

  it('formats noul answer as YES when P >= 0.5', async () => {
    const client = mockApiClient({
      answers: { sky_blue: { type: 'noul', noul: 0.85 } },
    });
    const r = (await handleDecide(
      req({ questions: { sky_blue: noulQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('YES');
    expect(r.content[0].text).toContain('85.0%');
  });

  it('formats noul answer as NO when P < 0.5', async () => {
    const client = mockApiClient({
      answers: { sky_blue: { type: 'noul', noul: 0.3 } },
    });
    const r = (await handleDecide(
      req({ questions: { sky_blue: noulQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('30.0%');
  });

  it('formats noul as YES at exactly 0.5', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('YES');
    expect(r.content[0].text).toContain('50.0%');
  });

  it('handles noul with missing prob (defaults to 0)', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'noul' } },
    });
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  // ── Successful responses: choice ───────────────────────────────────

  it('formats choice answer with the highest-probability option', async () => {
    const client = mockApiClient({
      answers: {
        fav: { type: 'choice', choice: { red: 0.1, blue: 0.7, green: 0.2 } },
      },
    });
    const r = (await handleDecide(
      req({ questions: { fav: choiceQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('blue');
    expect(r.content[0].text).toContain('70.0%');
  });

  it('handles choice with missing choice field gracefully', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'choice' } },
    });
    const r = (await handleDecide(
      req({ questions: { q1: choiceQuestion() } }),
      client,
    )) as SuccessResult;
    // Should not crash — just skip this answer's line
    expect(r.content[0].type).toBe('text');
  });

  // ── Successful responses: score ────────────────────────────────────

  it('formats score answer with the highest-probability level', async () => {
    const client = mockApiClient({
      answers: {
        quality: { type: 'score', score: [0.05, 0.15, 0.6, 0.2] },
      },
    });
    const r = (await handleDecide(
      req({ questions: { quality: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('level 3/4');
    expect(r.content[0].text).toContain('60.0%');
  });

  it('handles score with missing score field gracefully', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'score' } },
    });
    const r = (await handleDecide(
      req({ questions: { q1: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].type).toBe('text');
  });

  // ── structuredContent shape ────────────────────────────────────────

  it('returns answers in structuredContent', async () => {
    const answers = {
      q1: { type: 'noul', noul: 0.9 },
      q2: { type: 'choice', choice: { a: 0.6, b: 0.4 } },
    };
    const client = mockApiClient({ answers });
    const r = (await handleDecide(
      req({
        questions: {
          q1: noulQuestion(),
          q2: choiceQuestion(),
        },
      }),
      client,
    )) as SuccessResult;

    expect(r.structuredContent.answers).toEqual(answers);
  });

  // ── _meta shape ────────────────────────────────────────────────────

  it('includes correct _meta fields', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
      usage: { cost: 0.001 },
    });
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as SuccessResult;

    expect(r._meta.server_version).toBe(SERVER_VERSION);
    expect(r._meta.model).toBe('typesafe/jev-1.13');
    expect(r._meta.question_count).toBe(1);
    expect(r._meta.usage).toEqual({ cost: 0.001 });
  });

  it('omits usage from _meta when not present', async () => {
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r._meta.usage).toBeUndefined();
  });

  // ── Multi-question summary ─────────────────────────────────────────

  it('produces multi-line summary for multiple questions', async () => {
    const client = mockApiClient({
      answers: {
        q1: { type: 'noul', noul: 0.9 },
        q2: { type: 'choice', choice: { a: 0.8, b: 0.2 } },
        q3: { type: 'score', score: [0.1, 0.9] },
      },
    });
    const r = (await handleDecide(
      req({
        questions: {
          q1: noulQuestion(),
          q2: choiceQuestion(),
          q3: scoreQuestion(),
        },
      }),
      client,
    )) as SuccessResult;
    const lines = r.content[0].text.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('q1');
    expect(lines[1]).toContain('q2');
    expect(lines[2]).toContain('q3');
  });

  // ── No answers returned ────────────────────────────────────────────

  it('returns INTERNAL when API returns empty answers', async () => {
    const client = mockApiClient({ answers: {} });
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No answers returned');
  });

  it('returns INTERNAL when API returns no answers field', async () => {
    const client = mockApiClient({});
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  // ── Upstream errors ────────────────────────────────────────────────

  it('classifies upstream HTTP errors', async () => {
    const client = mockApiClient(null, new Error('POST /alpha/decisions failed: HTTP 500'));
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
  });

  it('classifies auth errors from upstream', async () => {
    const err = new Error('invalid api key') as Error & { status: number };
    err.status = 401;
    const client = mockApiClient(null, err);
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  // ── Arguments fallback ─────────────────────────────────────────────

  it('handles missing arguments gracefully', async () => {
    const r = (await handleDecide(
      {
        params: {
          arguments: undefined as unknown as {
            questions: Record<string, unknown>;
          },
        },
      },
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});
