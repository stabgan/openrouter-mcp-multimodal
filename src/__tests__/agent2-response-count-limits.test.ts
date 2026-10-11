/**
 * Coverage for untested upstream response count/length limits in embed_text and decide.
 *
 * These branches protect against oversized or malformed upstream responses
 * and have ZERO prior test coverage (confirmed via exhaustive grep):
 *
 * embed_text:
 *  1. rawEmbeddings.length > inputArray.length → sliced to inputArray.length
 *     (upstream returns more embeddings than texts sent)
 *  2. rawEmbeddings.length === inputArray.length → no slicing (normal path)
 *  3. rawEmbeddings.length < inputArray.length → no slicing (short response)
 *
 * decide:
 *  4. processedAnswers >= questionNames.length → extra answers truncated
 *     (upstream returns more answers than questions sent)
 *  5. name.length > MAX_QUESTION_NAME_LENGTH (256) in response → skipped
 *     (upstream answer key is absurdly long)
 *  6. Combination: extra answers AND oversized keys in single response
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
      { type: string; noul?: number; choice?: Record<string, number>; score?: number[] }
    >;
  };
  _meta: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function noulQuestion(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

// ===========================================================================
// 1–3. embed_text — upstream returns more embeddings than texts sent
// ===========================================================================

describe('handleEmbedText — response embedding count cap', () => {
  it('slices extra embeddings when upstream returns more than texts sent', async () => {
    // Send 2 texts, but upstream returns 5 embedding objects
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: [0.3, 0.4] },
        { index: 2, embedding: [0.5, 0.6] },
        { index: 3, embedding: [0.7, 0.8] },
        { index: 4, embedding: [0.9, 1.0] },
      ],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello', 'world'] }),
      client,
    )) as EmbedSuccess;

    // Only 2 embeddings should be returned (matching the 2 texts sent)
    expect(r.structuredContent.embeddings).toHaveLength(2);
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0.2]);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([0.3, 0.4]);
    expect(r.content[0].text).toContain('2 embedding(s)');
    expect(r._meta.embedding_count).toBe(2);
  });

  it('does not slice when upstream returns exact count', async () => {
    // Send 3 texts, upstream returns exactly 3 embeddings
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
        { index: 2, embedding: [0.3] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b', 'c'] }), client)) as EmbedSuccess;

    expect(r.structuredContent.embeddings).toHaveLength(3);
  });

  it('does not slice when upstream returns fewer than sent', async () => {
    // Send 3 texts, upstream returns only 1 embedding (partial response)
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5, 0.6] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b', 'c'] }), client)) as EmbedSuccess;

    expect(r.structuredContent.embeddings).toHaveLength(1);
    expect(r.content[0].text).toContain('1 embedding(s)');
  });

  it('slices with single text when upstream returns many', async () => {
    // Send 1 text (as string), upstream returns 3 embeddings
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
        { index: 2, embedding: [0.3] },
      ],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'single' }), client)) as EmbedSuccess;

    // Single text → inputArray.length === 1 → only first embedding kept
    expect(r.structuredContent.embeddings).toHaveLength(1);
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1]);
    expect(r._meta.embedding_count).toBe(1);
  });
});

// ===========================================================================
// 4. decide — upstream returns more answers than questions sent
// ===========================================================================

describe('handleDecide — response answer count cap', () => {
  it('truncates extra answers when upstream returns more than questions sent', async () => {
    // Send 2 questions, but upstream returns 5 answers
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.9 },
        q2: { type: 'noul', noul: 0.3 },
        extra1: { type: 'noul', noul: 0.5 },
        extra2: { type: 'noul', noul: 0.7 },
        extra3: { type: 'noul', noul: 0.1 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: noulQuestion('Is water wet?'),
        },
      }),
      client,
    )) as DecideSuccess;

    // Only 2 answers should be processed (matching the 2 questions sent)
    const answerKeys = Object.keys(r.structuredContent.answers);
    expect(answerKeys.length).toBe(2);
    expect(r._meta.question_count).toBe(2);
  });

  it('processes all answers when count matches questions', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.8 },
        q2: { type: 'noul', noul: 0.4 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: noulQuestion('Is fire hot?'),
        },
      }),
      client,
    )) as DecideSuccess;

    expect(Object.keys(r.structuredContent.answers)).toHaveLength(2);
    expect(r.content[0].text).toContain('q1');
    expect(r.content[0].text).toContain('q2');
  });

  it('processes all answers when upstream returns fewer than questions', async () => {
    // Send 3 questions, upstream returns only 1 answer
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.6 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: noulQuestion('Is fire hot?'),
          q3: noulQuestion('Is ice cold?'),
        },
      }),
      client,
    )) as DecideSuccess;

    // Only 1 answer from upstream → only 1 in structuredContent
    expect(Object.keys(r.structuredContent.answers)).toHaveLength(1);
    expect(r.structuredContent.answers.q1).toBeDefined();
  });
});

// ===========================================================================
// 5. decide — upstream answer keys exceeding MAX_QUESTION_NAME_LENGTH (256)
// ===========================================================================

describe('handleDecide — response answer key length cap', () => {
  it('skips answer keys exceeding 256 chars from upstream response', async () => {
    const longKey = 'x'.repeat(257);
    const client = mockDecideClient({
      answers: {
        [longKey]: { type: 'noul', noul: 0.9 },
        q1: { type: 'noul', noul: 0.7 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: noulQuestion('Another question'),
        },
      }),
      client,
    )) as DecideSuccess;

    // The long key should be skipped, only q1 should appear
    expect(r.structuredContent.answers).not.toHaveProperty(longKey);
    expect(r.structuredContent.answers.q1).toBeDefined();
    expect(r.content[0].text).toContain('q1');
    expect(r.content[0].text).not.toContain(longKey.slice(0, 50));
  });

  it('accepts answer keys at exactly 256 chars from upstream', async () => {
    const exactKey = 'y'.repeat(256);
    const client = mockDecideClient({
      answers: {
        [exactKey]: { type: 'noul', noul: 0.8 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          [exactKey]: noulQuestion(),
        },
      }),
      client,
    )) as DecideSuccess;

    // 256-char key should be accepted
    expect(r.structuredContent.answers[exactKey]).toBeDefined();
    expect(r.structuredContent.answers[exactKey].type).toBe('noul');
  });
});

// ===========================================================================
// 6. decide — combination: extra answers AND oversized keys
// ===========================================================================

describe('handleDecide — combined response limits', () => {
  it('skips long keys and truncates extra answers simultaneously', async () => {
    const longKey = 'z'.repeat(300);
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.9 },
        [longKey]: { type: 'noul', noul: 0.5 }, // skipped: key too long
        extra1: { type: 'noul', noul: 0.3 }, // potentially truncated
        extra2: { type: 'noul', noul: 0.4 }, // potentially truncated
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
        },
      }),
      client,
    )) as DecideSuccess;

    // Only 1 question sent → at most 1 answer processed
    // The long key is skipped (doesn't count toward processedAnswers)
    // q1 counts as 1 → limit reached → extra1/extra2 truncated
    const keys = Object.keys(r.structuredContent.answers);
    expect(keys.length).toBeLessThanOrEqual(1);
    expect(r.structuredContent.answers.q1).toBeDefined();
  });

  it('handles all-oversized answer keys gracefully', async () => {
    const long1 = 'a'.repeat(257);
    const long2 = 'b'.repeat(300);
    const client = mockDecideClient({
      answers: {
        [long1]: { type: 'noul', noul: 0.9 },
        [long2]: { type: 'noul', noul: 0.5 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
        },
      }),
      client,
    )) as DecideSuccess;

    // Both answer keys are too long → both skipped
    // structuredContent.answers should be empty
    expect(Object.keys(r.structuredContent.answers)).toHaveLength(0);
    // Summary text should be empty (no lines added)
    expect(r.content[0].text).toBe('');
  });
});
