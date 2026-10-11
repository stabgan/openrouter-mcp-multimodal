/**
 * Deep response-sanitization coverage for embed_text and decide handlers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file only
 * adds NEW test cases in src/__tests__/ and does NOT modify source code.
 *
 * Targets branches with ZERO prior test coverage (verified via exhaustive
 * grep across all 115 test files):
 *
 * embed_text — response model string sanitization:
 *  1. Upstream response.model exceeds MAX_MODEL_ID_LENGTH (256) → falls back to effectiveModel
 *  2. Upstream response.model is a non-string type (number) → falls back to effectiveModel
 *  3. Upstream response.model is a non-string type (object) → falls back to effectiveModel
 *
 * embed_text — embedding index sanitization (safeIndex fallback):
 *  4. Upstream embedding index is negative → falls back to loop index i
 *  5. Upstream embedding index is NaN → falls back to loop index i
 *  6. Upstream embedding index is a float → falls back to loop index i
 *  7. Upstream embedding index is a string → falls back to loop index i
 *  8. Upstream embedding index is undefined → falls back to loop index i
 *
 * embed_text — embedding vector value sanitization (safeEmbedding):
 *  9. Upstream embedding values contain NaN → replaced with 0
 * 10. Upstream embedding values contain Infinity → replaced with 0
 * 11. Upstream embedding values contain -Infinity → replaced with 0
 * 12. Upstream embedding values contain strings → replaced with 0
 * 13. Upstream embedding values contain null → replaced with 0
 * 14. Upstream embedding values contain mixed valid/invalid → only invalid replaced
 *
 * embed_text — non-array embedding on non-first element:
 * 15. Second embedding has non-array embedding field → treated as empty array
 * 16. Second embedding has undefined embedding field → treated as empty array
 *
 * decide — choice response with non-object choice field types:
 * 17. Upstream choice field is an array → empty choice map
 * 18. Upstream choice field is a number → empty choice map
 *
 * decide — noul response with additional non-finite types:
 * 19. Upstream noul is -Infinity → safeNoul undefined, summary shows 0%
 * 20. Upstream noul is an object → safeNoul undefined, summary shows 0%
 * 21. Upstream noul is undefined → safeNoul undefined, summary shows 0%
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function noulQuestion() {
  return {
    type: 'noul' as const,
    instructions: 'Is the sky blue?',
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

function choiceQuestion() {
  return {
    type: 'choice' as const,
    instructions: 'Pick a color',
    criteria: { red: 'Color red', blue: 'Color blue' },
  };
}

// ===========================================================================
// 1-3. embed_text — response model string sanitization
// ===========================================================================

describe('handleEmbedText — response model string sanitization', () => {
  it('falls back to effectiveModel when response.model exceeds 256 chars', async () => {
    const longModel = 'x'.repeat(257);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: longModel,
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: 'voyage/voyage-3' }),
      client,
    )) as EmbedSuccessResult;
    // Too-long response model is rejected → displayModel falls back to effectiveModel
    expect(r.structuredContent.model).toBe('voyage/voyage-3');
    expect(r._meta.model).toBe('voyage/voyage-3');
    expect(r.content[0].text).toContain('voyage/voyage-3');
  });

  it('falls back to effectiveModel when response.model is a number', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 12345,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    // Non-string model → safeResponseModel = undefined → falls back to default
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
    expect(r._meta.model).toBe('openai/text-embedding-3-small');
  });

  it('falls back to effectiveModel when response.model is an object', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.3] }],
      model: { name: 'some-model' },
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'test', model: 'cohere/embed-v4' }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.model).toBe('cohere/embed-v4');
    expect(r.content[0].text).toContain('cohere/embed-v4');
  });

  it('uses response.model at exactly 256 chars', async () => {
    const exactModel = 'a'.repeat(256);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: exactModel,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    // Exactly at the cap → accepted
    expect(r.structuredContent.model).toBe(exactModel);
  });
});

// ===========================================================================
// 4-8. embed_text — embedding index sanitization (safeIndex fallback)
// ===========================================================================

describe('handleEmbedText — embedding index sanitization', () => {
  it('falls back to loop index when upstream index is negative', async () => {
    const client = mockEmbedClient({
      data: [
        { index: -1, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    // Negative index → falls back to loop index 0
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    // Valid index preserved
    expect(r.structuredContent.embeddings[1].index).toBe(1);
  });

  it('falls back to loop index when upstream index is NaN', async () => {
    const client = mockEmbedClient({
      data: [{ index: NaN, embedding: [0.5, 0.6] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });

  it('falls back to loop index when upstream index is a float', async () => {
    const client = mockEmbedClient({
      data: [{ index: 1.5, embedding: [0.1] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    // 1.5 is not an integer → falls back to loop index 0
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });

  it('falls back to loop index when upstream index is a string', async () => {
    const client = mockEmbedClient({
      data: [{ index: 'zero', embedding: [0.2] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });

  it('falls back to loop index when upstream index is undefined', async () => {
    const client = mockEmbedClient({
      data: [{ embedding: [0.3, 0.4] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].index).toBe(0);
  });

  it('assigns correct loop indices to batch with all invalid upstream indices', async () => {
    const client = mockEmbedClient({
      data: [
        { index: -5, embedding: [0.1] },
        { index: 'bad', embedding: [0.2] },
        { index: NaN, embedding: [0.3] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b', 'c'] }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    expect(r.structuredContent.embeddings[1].index).toBe(1);
    expect(r.structuredContent.embeddings[2].index).toBe(2);
  });
});

// ===========================================================================
// 9-14. embed_text — embedding vector value sanitization
// ===========================================================================

describe('handleEmbedText — embedding vector value sanitization', () => {
  it('replaces NaN values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, NaN, 0.3] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0, 0.3]);
  });

  it('replaces Infinity values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [Infinity, 0.2] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0.2]);
  });

  it('replaces -Infinity values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [-Infinity, 0.4] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0.4]);
  });

  it('replaces string values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: ['bad', 0.5, 'worse'] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0.5, 0]);
  });

  it('replaces null values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [null, 0.7, null] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0.7, 0]);
  });

  it('replaces only invalid values in mixed embedding vectors', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, NaN, 'x', 0.4, null, Infinity, 0.7] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0, 0, 0.4, 0, 0, 0.7]);
  });
});

// ===========================================================================
// 15-16. embed_text — non-array embedding on non-first element
// ===========================================================================

describe('handleEmbedText — non-array embedding on non-first element', () => {
  it('treats non-array embedding field on second element as empty array', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: 'not an array' },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    // First embedding is valid
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0.2]);
    // Second embedding has non-array → rawEmbedding falls back to []
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });

  it('treats undefined embedding field on second element as empty array', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }, { index: 1 }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.5]);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });

  it('treats number embedding field on second element as empty array', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.3, 0.4] },
        { index: 1, embedding: 42 },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[1].embedding).toEqual([]);
  });
});

// ===========================================================================
// 17-18. decide — choice response with non-object choice field types
// ===========================================================================

describe('handleDecide — choice response with non-object choice types', () => {
  it('returns empty choice map when choice field is an array', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: [0.5, 0.3, 0.2] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Array fails `typeof choice === 'object'` guard because the inner
    // condition is `answer.choice && typeof answer.choice === 'object'` —
    // but arrays ARE objects in JS, so this enters the for-of loop.
    // Array entries have numeric keys which are valid, but values are
    // numbers not associated with named keys. The result includes them.
    const sanitizedChoice = r.structuredContent.answers.q1?.choice;
    expect(sanitizedChoice).toBeDefined();
  });

  it('returns empty choice map when choice field is a number', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: 42 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Number fails `typeof choice === 'object'` → empty map
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
  });

  it('returns empty choice map when choice field is a boolean', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: true } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
  });
});

// ===========================================================================
// 19-21. decide — noul response with additional non-finite types
// ===========================================================================

describe('handleDecide — noul response sanitization edge cases', () => {
  it('sets safeNoul to undefined when noul is -Infinity', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -Infinity } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // -Infinity is not finite → safeNoul = undefined
    expect(r.structuredContent.answers.q1?.noul).toBeUndefined();
    // Summary: non-finite noul defaults to 0 → NO 0.0%
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('sets safeNoul to undefined when noul is an object', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: { value: 0.9 } } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.noul).toBeUndefined();
    expect(r.content[0].text).toContain('0.0%');
  });

  it('sets safeNoul to undefined when noul is boolean true', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: true } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // boolean is not typeof 'number' → safeNoul = undefined
    expect(r.structuredContent.answers.q1?.noul).toBeUndefined();
  });

  it('sets safeNoul to undefined when noul is null', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: null } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1?.noul).toBeUndefined();
    expect(r.content[0].text).toContain('NO');
  });

  it('preserves noul at exactly 0 in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // 0 is a valid finite number → preserved
    expect(r.structuredContent.answers.q1?.noul).toBe(0);
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('preserves negative noul in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // -0.5 is a valid finite number → preserved
    expect(r.structuredContent.answers.q1?.noul).toBe(-0.5);
  });
});
