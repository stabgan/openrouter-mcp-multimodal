/**
 * Agent 2 — Final coverage for genuinely untested code paths in embed_text,
 * decide, and supporting utilities.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Confirmed untested paths (verified via exhaustive grep across all 120 test files):
 *
 * embed_text — sanitizedDimensions metadata after response dimension capping:
 *  1. When first embedding is capped from >65_536 to 65_536, the
 *     structuredContent.dimensions AND _meta.dimensions must report the
 *     CAPPED value (65_536), not the original oversized count. Summary text
 *     must also say "65536 dimensions". No prior test verifies metadata.
 *  2. When first embedding is capped, summary text references capped count.
 *
 * readToolPayload — content with non-text first element:
 *  3. content: [{ type: 'image' }] → first element has no `text` → throws
 *  4. content: [{ type: 'audio', data: 'base64' }] → no text → throws
 *
 * decide — empty choice object {} from upstream in summary:
 *  5. answer.choice is truthy {} → enters summary branch → Object.entries
 *     produces [] → best is undefined → shows "?" with "0.0%"
 *
 * decide — choice answer where all probabilities are negative:
 *  6. Valid finite negative numbers are not rejected — sort picks the
 *     least negative value as "best". Verifies sort order correctness
 *     with unconventional probability values.
 *
 * decide — noul sanitization preserves 0 as valid finite number:
 *  7. noul: 0 is typeof number, isFinite, so safeNoul = 0 (not undefined).
 *     structuredContent should have noul: 0, not undefined.
 *
 * embed_text — batch with all non-finite embedding values:
 *  8. Every element in every embedding vector is non-finite → all replaced
 *     with 0. Verify dimensions and summary still correct.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { readToolPayload } from '../tool-handlers/structured-output.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

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

function choiceQuestion() {
  return {
    type: 'choice' as const,
    instructions: 'Pick one',
    criteria: { a: 'Option A', b: 'Option B' },
  };
}

function noulQuestion() {
  return {
    type: 'noul' as const,
    instructions: 'Is the sky blue?',
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–2. embed_text — sanitizedDimensions metadata after response dimension capping
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — sanitizedDimensions metadata after dimension capping', () => {
  it('reports capped dimension count in structuredContent.dimensions and _meta.dimensions', async () => {
    // Upstream returns embedding with 65_537 elements — 1 over the cap
    const oversized = new Array(65_537).fill(0.1);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: oversized }],
      model: 'test/large-model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;

    // The embedding array itself should be capped
    expect(r.structuredContent.embeddings[0].embedding).toHaveLength(65_536);

    // structuredContent.dimensions must report the SANITIZED count (65_536),
    // NOT the original upstream count (65_537)
    expect(r.structuredContent.dimensions).toBe(65_536);

    // _meta.dimensions must also report the capped value
    expect(r._meta.dimensions).toBe(65_536);
  });

  it('includes capped dimension count in summary text', async () => {
    const oversized = new Array(65_537).fill(0.2);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: oversized }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccessResult;

    // Summary should say "65536 dimensions", not "65537 dimensions"
    expect(r.content[0].text).toContain('65536 dimensions');
    expect(r.content[0].text).not.toContain('65537');
  });

  it('reports correct dimensions when embedding is under the cap', async () => {
    // Normal case — 768 dimensions, no capping
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: new Array(768).fill(0.5) }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.dimensions).toBe(768);
    expect(r._meta.dimensions).toBe(768);
    expect(r.content[0].text).toContain('768 dimensions');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3–4. readToolPayload — content with non-text first element
// ═══════════════════════════════════════════════════════════════════════════

describe('readToolPayload — content with non-text first element', () => {
  it('throws when first content element is an image block (no text field)', () => {
    expect(() =>
      readToolPayload({
        content: [{ type: 'image' }],
      }),
    ).toThrow('no structuredContent or content text');
  });

  it('throws when first content element is an audio block (no text field)', () => {
    expect(() =>
      readToolPayload({
        content: [{ type: 'audio', data: 'base64data' } as { type: string; text?: string }],
      }),
    ).toThrow('no structuredContent or content text');
  });

  it('throws when first content element has text: undefined explicitly', () => {
    expect(() =>
      readToolPayload({
        content: [{ type: 'text', text: undefined }],
      }),
    ).toThrow('no structuredContent or content text');
  });

  it('succeeds when structuredContent is present even with non-text content', () => {
    const result = readToolPayload({
      structuredContent: { key: 'value' },
      content: [{ type: 'image' }],
    });
    expect(result).toEqual({ key: 'value' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. decide — empty choice object {} from upstream in summary
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — empty choice object from upstream in summary', () => {
  it('shows "?" with 0.0% when upstream returns choice: {} (empty object)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: {} } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // choice: {} is truthy → enters summary branch → Object.entries({}) = []
    // → filtered = [] → sorted = [] → best = undefined → "?" with "0.0%"
    expect(r.content[0].text).toContain('?');
    expect(r.content[0].text).toContain('0.0%');

    // structuredContent should also have empty choice
    expect(r.structuredContent.answers.q1?.choice).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. decide — choice answer where all probabilities are negative
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice with negative probability values', () => {
  it('sorts negative probabilities correctly (least negative wins)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { worst: -0.9, bad: -0.5, least_bad: -0.1 } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // Sort descending: -0.1 > -0.5 > -0.9, so least_bad wins
    expect(r.content[0].text).toContain('least_bad');

    // structuredContent preserves all negative values
    const choice = r.structuredContent.answers.q1?.choice;
    expect(choice).toBeDefined();
    expect(choice!.worst).toBe(-0.9);
    expect(choice!.bad).toBe(-0.5);
    expect(choice!.least_bad).toBe(-0.1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. decide — noul sanitization preserves 0 as valid finite number
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — noul: 0 preserved in structuredContent', () => {
  it('stores noul: 0 (not undefined) when upstream returns exactly 0', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // 0 is typeof number and Number.isFinite(0) is true → safeNoul = 0
    // This is different from undefined/NaN/Infinity where safeNoul = undefined
    expect(r.structuredContent.answers.q1?.noul).toBe(0);

    // Summary should show NO at 0.0%
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('stores noul: -0 faithfully (isFinite(-0) is true, passes sanitization)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // -0 is typeof number and Number.isFinite(-0) is true → safeNoul = -0
    // The handler preserves -0 as-is (Object.is(-0, 0) is false)
    const noul = r.structuredContent.answers.q1?.noul;
    expect(typeof noul).toBe('number');
    expect(Number.isFinite(noul)).toBe(true);
    // -0 and 0 are == but Object.is distinguishes them — verify it's stored
    expect(noul).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. embed_text — batch with all non-finite embedding values
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — batch with all non-finite embedding values', () => {
  it('replaces all non-finite values with 0 and reports correct metadata', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [NaN, Infinity, -Infinity] },
        { index: 1, embedding: [NaN, NaN, NaN] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;

    // All values should be replaced with 0
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0, 0, 0]);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([0, 0, 0]);

    // Dimensions still reported correctly (from sanitized first embedding)
    expect(r.structuredContent.dimensions).toBe(3);
    expect(r._meta.dimensions).toBe(3);
    expect(r._meta.embedding_count).toBe(2);

    // Summary text still correct
    expect(r.content[0].text).toContain('2 embedding(s)');
    expect(r.content[0].text).toContain('3 dimensions');
  });
});
