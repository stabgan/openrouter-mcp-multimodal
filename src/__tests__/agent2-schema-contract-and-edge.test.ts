/**
 * Agent 2 — Schema contract tests and remaining edge-case coverage for
 * embed_text and decide handlers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Novel coverage areas (verified via exhaustive grep across all 131 test files):
 *
 * A. Output schema contract tests:
 *    1. embed_text structuredContent matches outputSchema declared in tool-definitions.ts
 *       (embeddings array with index+embedding, model string, dimensions integer)
 *    2. decide structuredContent matches outputSchema declared in tool-definitions.ts
 *       (answers map with type + type-specific fields)
 *    3. embed_text structuredContent is JSON-serializable without loss
 *    4. decide structuredContent is JSON-serializable without loss
 *
 * B. Handler idempotency:
 *    5. embed_text produces identical results for identical inputs
 *    6. decide produces identical results for identical inputs
 *
 * C. Remaining edge cases:
 *    7. embed_text with undefined params.arguments.model (explicit undefined, not missing)
 *    8. embed_text where upstream returns non-integer index on non-first element
 *       (array position fallback verified for elements > 0)
 *    9. decide where ALL upstream answers are prototype-pollution keys
 *       (every key is __proto__/constructor/prototype — sanitizedAnswers is empty object)
 *   10. decide where upstream answer has all three type-specific fields
 *       (noul + choice + score on same answer — only the matching one preserved)
 *   11. decide where response.answers is a non-null non-object non-array value (number)
 *   12. embed_text response.data field is boolean false (falsy but not nullish)
 *   13. decide structuredContent.answers preserves answer order from upstream
 *   14. embed_text with texts containing null byte characters (\0)
 *   15. decide with model that has leading/trailing whitespace trimmed to valid ID
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { TOOL_DEFINITIONS } from '../tool-definitions.js';
import { SERVER_VERSION } from '../version.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ═══════════════════════════════════════════════════════════════════════════
// Type helpers
// ═══════════════════════════════════════════════════════════════════════════

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type EmbedSuccess = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
};

type DecideSuccess = {
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

function noulQ(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Sky is blue', no: 'Sky is not blue' },
  };
}

function choiceQ(instructions = 'Pick a color') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { red: 'Red color', blue: 'Blue color', green: 'Green color' },
  };
}

function scoreQ(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper: validate structuredContent against declared outputSchema
// ═══════════════════════════════════════════════════════════════════════════

function getOutputSchema(toolName: string): Record<string, unknown> {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === toolName);
  if (!tool || !tool.outputSchema) throw new Error(`No outputSchema for ${toolName}`);
  return tool.outputSchema as Record<string, unknown>;
}

/**
 * Shallow schema validator — checks that the structuredContent has the
 * required properties and correct types declared in the outputSchema.
 * Not a full JSON Schema validator, but catches contract violations.
 */
function validateAgainstSchema(
  data: Record<string, unknown>,
  schema: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const required = (schema.required ?? []) as string[];
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;

  for (const key of required) {
    if (!(key in data)) {
      errors.push(`Missing required property: ${key}`);
    }
  }

  for (const [key, propSchema] of Object.entries(properties)) {
    if (!(key in data)) continue;
    const value = data[key];
    const expectedType = propSchema.type as string | undefined;

    if (expectedType === 'string' && typeof value !== 'string') {
      errors.push(`${key}: expected string, got ${typeof value}`);
    }
    if (expectedType === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) {
      errors.push(`${key}: expected integer, got ${typeof value} (${value})`);
    }
    if (expectedType === 'number' && typeof value !== 'number') {
      errors.push(`${key}: expected number, got ${typeof value}`);
    }
    if (expectedType === 'array' && !Array.isArray(value)) {
      errors.push(`${key}: expected array, got ${typeof value}`);
    }
    if (expectedType === 'object' && (typeof value !== 'object' || value === null)) {
      errors.push(`${key}: expected object, got ${value === null ? 'null' : typeof value}`);
    }
  }

  return errors;
}

// ═══════════════════════════════════════════════════════════════════════════
// A. Output schema contract tests
// ═══════════════════════════════════════════════════════════════════════════

describe('embed_text — output schema contract', () => {
  const schema = getOutputSchema('embed_text');

  it('structuredContent matches declared outputSchema for single embedding', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;

    const errors = validateAgainstSchema(
      r.structuredContent as unknown as Record<string, unknown>,
      schema,
    );
    expect(errors).toEqual([]);

    // Verify embedding items shape
    for (const emb of r.structuredContent.embeddings) {
      expect(typeof emb.index).toBe('number');
      expect(Number.isInteger(emb.index)).toBe(true);
      expect(Array.isArray(emb.embedding)).toBe(true);
      for (const v of emb.embedding) {
        expect(typeof v).toBe('number');
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('structuredContent matches declared outputSchema for batch embeddings', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
        { index: 2, embedding: [0.3] },
      ],
      model: 'voyage/voyage-3',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b', 'c'] }), client)) as EmbedSuccess;

    const errors = validateAgainstSchema(
      r.structuredContent as unknown as Record<string, unknown>,
      schema,
    );
    expect(errors).toEqual([]);
    expect(r.structuredContent.embeddings).toHaveLength(3);
    expect(typeof r.structuredContent.model).toBe('string');
    expect(Number.isInteger(r.structuredContent.dimensions)).toBe(true);
  });

  it('structuredContent is JSON-serializable without loss', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.123456789, -0.987654321] },
        { index: 1, embedding: [0.0, 1.0] },
      ],
      model: 'openai/text-embedding-3-small',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello', 'world'] }),
      client,
    )) as EmbedSuccess;

    // Round-trip through JSON
    const serialized = JSON.stringify(r.structuredContent);
    const deserialized = JSON.parse(serialized);
    expect(deserialized).toEqual(r.structuredContent);

    // Verify no data loss on embeddings
    expect(deserialized.embeddings[0].embedding[0]).toBe(0.123456789);
    expect(deserialized.embeddings[0].embedding[1]).toBe(-0.987654321);
  });
});

describe('decide — output schema contract', () => {
  const schema = getOutputSchema('decide');

  it('structuredContent matches declared outputSchema for noul answer', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.85 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccess;

    const errors = validateAgainstSchema(
      r.structuredContent as unknown as Record<string, unknown>,
      schema,
    );
    expect(errors).toEqual([]);

    const answer = r.structuredContent.answers.q1;
    expect(answer.type).toBe('noul');
    expect(typeof answer.noul).toBe('number');
    expect(Number.isFinite(answer.noul!)).toBe(true);
  });

  it('structuredContent matches declared outputSchema for choice answer', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: { red: 0.1, blue: 0.7, green: 0.2 } } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccess;

    const errors = validateAgainstSchema(
      r.structuredContent as unknown as Record<string, unknown>,
      schema,
    );
    expect(errors).toEqual([]);

    const choice = r.structuredContent.answers.q1.choice!;
    for (const [, v] of Object.entries(choice)) {
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('structuredContent matches declared outputSchema for score answer', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.1, 0.3, 0.4, 0.2] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as DecideSuccess;

    const errors = validateAgainstSchema(
      r.structuredContent as unknown as Record<string, unknown>,
      schema,
    );
    expect(errors).toEqual([]);

    const score = r.structuredContent.answers.q1.score!;
    expect(Array.isArray(score)).toBe(true);
    for (const v of score) {
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('structuredContent matches declared outputSchema for mixed answer types', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.9 },
        q2: { type: 'choice', choice: { a: 0.6, b: 0.4 } },
        q3: { type: 'score', score: [0.1, 0.9] },
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
    )) as DecideSuccess;

    const errors = validateAgainstSchema(
      r.structuredContent as unknown as Record<string, unknown>,
      schema,
    );
    expect(errors).toEqual([]);
    expect(Object.keys(r.structuredContent.answers)).toHaveLength(3);
  });

  it('structuredContent is JSON-serializable without loss', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.123456789 },
        q2: { type: 'choice', choice: { a: 0.654321, b: 0.345679 } },
        q3: { type: 'score', score: [0.01, 0.02, 0.97] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQ(), q2: choiceQ(), q3: scoreQ() },
      }),
      client,
    )) as DecideSuccess;

    const serialized = JSON.stringify(r.structuredContent);
    const deserialized = JSON.parse(serialized);
    expect(deserialized).toEqual(r.structuredContent);
    expect(deserialized.answers.q1.noul).toBe(0.123456789);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Handler idempotency
// ═══════════════════════════════════════════════════════════════════════════

describe('embed_text — idempotency', () => {
  it('produces identical results for identical inputs', async () => {
    const response = {
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: 'openai/text-embedding-3-small',
      usage: { prompt_tokens: 3, total_tokens: 3 },
    };
    const client1 = mockEmbedClient(response);
    const client2 = mockEmbedClient(response);
    const args = { texts: 'hello world' };

    const r1 = (await handleEmbedText(embedReq(args), client1)) as EmbedSuccess;
    const r2 = (await handleEmbedText(embedReq(args), client2)) as EmbedSuccess;

    expect(r1.content).toEqual(r2.content);
    expect(r1.structuredContent).toEqual(r2.structuredContent);
    expect(r1._meta).toEqual(r2._meta);
  });
});

describe('decide — idempotency', () => {
  it('produces identical results for identical inputs', async () => {
    const response = {
      answers: {
        q1: { type: 'noul', noul: 0.85 },
        q2: { type: 'choice', choice: { a: 0.7, b: 0.3 } },
      },
      usage: { cost: 0.001 },
    };
    const client1 = mockDecideClient(response);
    const client2 = mockDecideClient(response);
    const args = { questions: { q1: noulQ(), q2: choiceQ() } };

    const r1 = (await handleDecide(decideReq(args), client1)) as DecideSuccess;
    const r2 = (await handleDecide(decideReq(args), client2)) as DecideSuccess;

    expect(r1.content).toEqual(r2.content);
    expect(r1.structuredContent).toEqual(r2.structuredContent);
    expect(r1._meta).toEqual(r2._meta);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Remaining edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('embed_text — remaining edge cases', () => {
  // 7. explicit undefined model uses default
  it('uses default model when model is explicitly undefined', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'test', model: undefined }),
      client,
    )) as EmbedSuccess;
    expect(r._meta.model).toBe('openai/text-embedding-3-small');
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/text-embedding-3-small' }),
    );
  });

  // 8. non-first element with non-integer index falls back to array position
  it('falls back to array position for non-first elements with non-integer index', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 'bad', embedding: [0.2] },
        { index: -5, embedding: [0.3] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b', 'c'] }), client)) as EmbedSuccess;

    expect(r.structuredContent.embeddings[0].index).toBe(0);
    // 'bad': typeof !== 'number' → falls back to positional index 1
    expect(r.structuredContent.embeddings[1].index).toBe(1);
    // -5: typeof === 'number', isInteger true, but < 0 → falls back to positional index 2
    expect(r.structuredContent.embeddings[2].index).toBe(2);
  });

  // 12. data: false is falsy but not nullish — triggers INTERNAL
  it('returns INTERNAL when response.data is boolean false', async () => {
    const client = mockEmbedClient({ data: false, model: 'test/model' });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  // 14. texts with null byte characters
  it('accepts texts containing null byte characters', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello\x00world' }),
      client,
    )) as EmbedSuccess;
    expect(r.structuredContent.embeddings).toHaveLength(1);
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ input: ['hello\x00world'] }),
    );
  });

  // _meta always has server_version
  it('always includes server_version in _meta', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccess;
    expect(r._meta.server_version).toBe(SERVER_VERSION);
  });

  // Verify content[0].type is always 'text'
  it('always returns content with type "text"', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
  });
});

describe('decide — remaining edge cases', () => {
  // 9. ALL upstream answer keys are prototype-pollution keys
  it('produces empty sanitizedAnswers when all answer keys are unsafe', async () => {
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.9 };
    answers['constructor'] = { type: 'noul', noul: 0.8 };
    answers['prototype'] = { type: 'noul', noul: 0.7 };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccess;
    // All answer keys are unsafe → all skipped → empty answers
    expect(Object.keys(r.structuredContent.answers)).toHaveLength(0);
    expect(r.content[0].text).toBe('');
  });

  // 10. upstream answer has all three type-specific fields — only matching one preserved
  it('preserves only the matching type field when answer has all three', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.8, choice: { a: 0.5 }, score: [0.1, 0.9] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccess;
    const answer = r.structuredContent.answers.q1;
    expect(answer.type).toBe('noul');
    expect(answer.noul).toBe(0.8);
    // Extra type-specific fields stripped by allowlist sanitization
    expect(answer.choice).toBeUndefined();
    expect(answer.score).toBeUndefined();
  });

  it('preserves only choice when answer type is choice but has noul and score', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', noul: 0.5, choice: { a: 0.6, b: 0.4 }, score: [0.1] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as DecideSuccess;
    const answer = r.structuredContent.answers.q1;
    expect(answer.type).toBe('choice');
    expect(answer.choice).toEqual({ a: 0.6, b: 0.4 });
    expect(answer.noul).toBeUndefined();
    expect(answer.score).toBeUndefined();
  });

  it('preserves only score when answer type is score but has noul and choice', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', noul: 0.5, choice: { x: 0.5 }, score: [0.3, 0.7] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as DecideSuccess;
    const answer = r.structuredContent.answers.q1;
    expect(answer.type).toBe('score');
    expect(answer.score).toEqual([0.3, 0.7]);
    expect(answer.noul).toBeUndefined();
    expect(answer.choice).toBeUndefined();
  });

  // 11. answers is a number (non-null non-object non-array)
  it('returns INTERNAL when answers is a number', async () => {
    const client = mockDecideClient({ answers: 42 });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No answers returned');
  });

  // 13. answer order preserved
  it('preserves answer order from upstream in structuredContent', async () => {
    const client = mockDecideClient({
      answers: {
        alpha: { type: 'noul', noul: 0.1 },
        beta: { type: 'noul', noul: 0.2 },
        gamma: { type: 'noul', noul: 0.3 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          alpha: noulQ(),
          beta: noulQ(),
          gamma: noulQ(),
        },
      }),
      client,
    )) as DecideSuccess;
    const keys = Object.keys(r.structuredContent.answers);
    expect(keys).toEqual(['alpha', 'beta', 'gamma']);
  });

  // 15. model with leading/trailing whitespace trimmed
  it('trims model whitespace to a valid ID', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    await handleDecide(
      decideReq({
        questions: { q1: noulQ() },
        model: '\t  typesafe/jev-1.13  \n',
      }),
      client,
    );
    expect(client.submitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'typesafe/jev-1.13' }),
    );
  });

  // _meta always has server_version and question_count
  it('always includes server_version and question_count in _meta', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as DecideSuccess;
    expect(r._meta.server_version).toBe(SERVER_VERSION);
    expect(r._meta.question_count).toBe(1);
    expect(r._meta.model).toBe('typesafe/jev-1.13');
  });

  // Error responses always have isError and valid code
  it('error responses always have isError: true and valid _meta.code', async () => {
    const testCases: Record<string, unknown>[] = [
      {}, // missing questions
      { questions: null }, // null questions
      { questions: [] }, // array questions
      { questions: {} }, // empty questions
      { questions: { q1: 'not an object' } }, // non-object question
    ];

    for (const args of testCases) {
      const r = (await handleDecide(decideReq(args), mockDecideClient({}))) as ErrorResult;
      expect(r.isError).toBe(true);
      expect(typeof r._meta.code).toBe('string');
      expect(r._meta.code.length).toBeGreaterThan(0);
      expect(r.content).toHaveLength(1);
      expect(r.content[0].type).toBe('text');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Prototype-pollution safety invariants
// ═══════════════════════════════════════════════════════════════════════════

describe('embed_text — prototype-pollution safety in output', () => {
  it('structuredContent never contains __proto__, constructor, or prototype keys', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: [0.3, 0.4] },
      ],
      model: 'test/model',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as EmbedSuccess;

    const json = JSON.stringify(r.structuredContent);
    expect(json).not.toContain('__proto__');
    expect(json).not.toContain('"constructor"');
    expect(json).not.toContain('"prototype"');
  });
});

describe('decide — prototype-pollution safety in output', () => {
  it('structuredContent never contains __proto__, constructor, or prototype keys', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.8 },
        q2: { type: 'choice', choice: { a: 0.6, b: 0.4 } },
        q3: { type: 'score', score: [0.1, 0.9] },
      },
      usage: { cost: 0.001 },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQ(), q2: choiceQ(), q3: scoreQ() },
      }),
      client,
    )) as DecideSuccess;

    const json = JSON.stringify(r.structuredContent);
    expect(json).not.toContain('__proto__');
    expect(json).not.toContain('"constructor"');
    expect(json).not.toContain('"prototype"');
  });
});
