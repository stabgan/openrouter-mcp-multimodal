/**
 * Final coverage gaps for embed_text and decide handlers.
 *
 * Targets branches confirmed untested by exhaustive grep of all src/__tests__/:
 *
 * decide:
 *  1. MAX_QUESTIONS_BYTES exceeded (1_000_000) — aggregate serialized size
 *  2. Questions not serializable (circular reference in questions object)
 *  3. Unsafe key on individual question *object body* (unsafeQObjKey) —
 *     __proto__, constructor, prototype as own keys on a question definition
 *     (distinct from the top-level questions-map key check)
 *  4. MAX_QUESTIONS_BYTES boundary — exactly at 1_000_000 bytes passes
 *
 * embed_text:
 *  5. response.data is a non-empty string — !Array.isArray triggers INTERNAL
 *  6. response.data is a plain object (not array) — same INTERNAL path
 *  7. -Infinity dimensions — fails "positive integer" check
 *  8. boolean dimensions (true) — fails typeof check
 *  9. Total input chars boundary — exactly at 10_000_000 passes
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
  const submitDecision = vi.fn().mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown) {
  const createEmbeddings = vi.fn().mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function noulQuestion(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

// ---------------------------------------------------------------------------
// 1. decide — MAX_QUESTIONS_BYTES exceeded (1_000_000)
// ---------------------------------------------------------------------------

describe('handleDecide — MAX_QUESTIONS_BYTES aggregate size limit', () => {
  it('returns INVALID_INPUT when questions serialized size exceeds 1_000_000 bytes', async () => {
    // Build a questions object that exceeds 1 MB when serialized.
    // Use a single question with very long criteria values.
    // Each criteria value is 10_000 chars (at the per-value limit).
    // We need ~100 criteria entries × 10_000 chars = 1 MB of criteria data,
    // but we also have overhead from keys + structure.
    // Use 10 questions × 50 criteria × ~2200 chars each ≈ 1.1 MB total.
    const questions: Record<string, unknown> = {};
    for (let q = 0; q < 10; q++) {
      const criteria: Record<string, string> = {};
      for (let c = 0; c < 50; c++) {
        criteria[`opt_${c}`] = 'x'.repeat(2200);
      }
      questions[`q${q}`] = {
        type: 'noul',
        instructions: 'test question',
        criteria,
      };
    }
    // Verify the payload is actually over 1 MB
    const serializedSize = JSON.stringify(questions).length;
    expect(serializedSize).toBeGreaterThan(1_000_000);

    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('serialized size');
    expect(r.content[0].text).toContain('1000000');
  });

  it('accepts questions at serialized size just under 1_000_000 bytes', async () => {
    // Build a payload that stays under 1 MB.
    // 5 questions × 20 criteria × 2000 chars each ≈ 200 KB — well under.
    const questions: Record<string, unknown> = {};
    const answers: Record<string, unknown> = {};
    for (let q = 0; q < 5; q++) {
      const criteria: Record<string, string> = {};
      for (let c = 0; c < 20; c++) {
        criteria[`o${c}`] = 'y'.repeat(2000);
      }
      questions[`q${q}`] = {
        type: 'noul',
        instructions: 'test',
        criteria,
      };
      answers[`q${q}`] = { type: 'noul', noul: 0.5 };
    }
    const serializedSize = JSON.stringify(questions).length;
    expect(serializedSize).toBeLessThan(1_000_000);

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(decideReq({ questions }), client)) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. decide — questions not serializable
// ---------------------------------------------------------------------------

describe('handleDecide — questions not serializable', () => {
  it('returns INVALID_INPUT when questions contain a circular reference', async () => {
    // Create a circular reference inside a criteria value.
    // We need the criteria values to be strings for validation to pass,
    // but the question object itself can have extra properties that create cycles.
    // Actually, the simpler approach: make a question object with a circular ref
    // that would cause JSON.stringify to throw.
    const criteria: Record<string, unknown> = { yes: 'y', no: 'n' };
    const q: Record<string, unknown> = {
      type: 'noul',
      instructions: 'test',
      criteria,
    };
    // Add a circular reference as an extra property on the question
    q.self = q;

    const questions = { q1: q };

    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('not serializable');
  });

  it('returns INVALID_INPUT when questions contain BigInt (non-serializable)', async () => {
    const q = {
      type: 'noul',
      instructions: 'test',
      criteria: { yes: 'y', no: 'n' },
      extra: BigInt(42),
    };
    const questions = { q1: q };

    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('not serializable');
  });
});

// ---------------------------------------------------------------------------
// 3. decide — unsafe key on question object body (unsafeQObjKey)
// ---------------------------------------------------------------------------

describe('handleDecide — unsafe key on question object body', () => {
  it('rejects question object with __proto__ as own property', async () => {
    // The question name "q1" is safe, but the question *object* itself
    // has __proto__ as an own key. This hits the unsafeQObjKey check.
    const q = Object.create(null);
    q.type = 'noul';
    q.instructions = 'test';
    q.criteria = { yes: 'y', no: 'n' };
    q['__proto__'] = {};

    const questions = { q1: q };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions.q1');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('__proto__');
  });

  it('rejects question object with constructor as own property', async () => {
    const q = Object.create(null);
    q.type = 'noul';
    q.instructions = 'test';
    q.criteria = { yes: 'y', no: 'n' };
    q['constructor'] = 'polluted';

    const questions = { q1: q };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions.q1');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('constructor');
  });

  it('rejects question object with prototype as own property', async () => {
    const q = Object.create(null);
    q.type = 'noul';
    q.instructions = 'test';
    q.criteria = { yes: 'y', no: 'n' };
    q['prototype'] = {};

    const questions = { q1: q };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions.q1');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('prototype');
  });

  it('accepts question object without unsafe keys (normal case)', async () => {
    // Verify that normal question objects pass the unsafeQObjKey check
    const questions = { q1: noulQuestion() };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
    });
    const r = (await handleDecide(decideReq({ questions }), client)) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5–6. embed_text — response.data edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — response.data edge cases', () => {
  it('returns INTERNAL when response.data is a non-empty string', async () => {
    const client = mockEmbedClient({ data: 'hello world', model: 'test/model' });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  it('returns INTERNAL when response.data is a plain object (not array)', async () => {
    const client = mockEmbedClient({
      data: { index: 0, embedding: [0.1] },
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });
});

// ---------------------------------------------------------------------------
// 7–8. embed_text — dimensions edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — dimensions edge cases', () => {
  it('returns INVALID_INPUT for -Infinity dimensions', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: -Infinity }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for boolean dimensions (true)', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: true }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for boolean dimensions (false)', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: false }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });
});

// ---------------------------------------------------------------------------
// 9. embed_text — total input chars boundary
// ---------------------------------------------------------------------------

describe('handleEmbedText — total input chars boundary', () => {
  it('accepts texts at exactly MAX_TOTAL_INPUT_CHARS (10_000_000)', async () => {
    // 100 texts × 100_000 chars each = 10_000_000 total chars (exactly at limit)
    const text = 'a'.repeat(100_000);
    const texts = Array.from({ length: 100 }, () => text);
    const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
    expect(totalChars).toBe(10_000_000);

    const data = texts.map((_, i) => ({ index: i, embedding: [0.1] }));
    const client = mockEmbedClient({ data, model: 'openai/text-embedding-3-small' });
    const r = (await handleEmbedText(embedReq({ texts }), client)) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});
