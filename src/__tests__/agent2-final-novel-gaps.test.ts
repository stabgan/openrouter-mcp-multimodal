/**
 * Agent 2 — Final novel gaps: genuinely untested code paths in embed_text,
 * decide, and their interaction with sanitizeUpstreamUsage.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Confirmed untested via exhaustive grep across all existing test files:
 *
 * embed_text:
 *  1. response.data is `false` (boolean false) — false is NOT nullish, so
 *     `false ?? []` evaluates to `false`, then `!Array.isArray(false)` → INTERNAL.
 *     Distinct from `data: null` (nullish → `[]`) and `data: true` (tested).
 *
 * decide — response.usage as truthy non-object:
 *  2. response.usage is a number (42) — truthy, passes `response.usage ?` check,
 *     sanitizer returns undefined, `_meta.usage` becomes `undefined`.
 *  3. response.usage is a string ("cached") — same pattern.
 *  4. response.usage is an array ([1,2,3]) — same pattern.
 *  5. response.usage is `true` (boolean) — same pattern.
 *     The decide handler uses `response.usage ? { usage: sanitize(...) } : {}`,
 *     unlike embed_text which checks the sanitized result: `safeUsage ? ...`.
 *     This means decide can set `_meta.usage = undefined` when embed_text would
 *     omit the key entirely.
 *
 * decide — answer entry as array:
 *  6. answer entry is `[]` — typeof `[]` is 'object', passes the guard,
 *     `[].type` is undefined → default switch case → `{ type: undefined }`.
 *
 * decide — answer entry as empty array with type property:
 *  7. answer entry is an array with type property set — exotic edge case.
 *
 * embed_text — usage divergence documentation:
 *  8. Verify embed_text omits _meta.usage entirely when response.usage is
 *     a truthy non-object (cleaner pattern than decide).
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; [key: string]: unknown };
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
    answers: Record<string, { type: string; [key: string]: unknown }>;
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

function noulQuestion(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

// ===========================================================================
// 1. embed_text — response.data is `false` (boolean false)
// ===========================================================================

describe('handleEmbedText — response.data is boolean false', () => {
  it('returns INTERNAL when response.data is false (not nullish)', async () => {
    // `false ?? []` evaluates to `false` (false is NOT nullish).
    // Then `!Array.isArray(false)` is true → INTERNAL error.
    // This is distinct from `data: null` which null-coalesces to `[]`.
    const client = mockEmbedClient({
      data: false,
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });
});

// ===========================================================================
// 2–5. decide — response.usage as truthy non-object values
// ===========================================================================

describe('handleDecide — response.usage as truthy non-object', () => {
  it('sets _meta.usage to undefined when response.usage is a number', async () => {
    // The decide handler checks `response.usage ?` directly (truthy check).
    // 42 is truthy → sanitizeUpstreamUsage(42) returns undefined →
    // spread adds { usage: undefined } → _meta.usage exists but is undefined.
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
      usage: 42,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers).toBeDefined();
    // The key 'usage' is present in _meta but its value is undefined
    expect('usage' in r._meta).toBe(true);
    expect(r._meta.usage).toBeUndefined();
  });

  it('sets _meta.usage to undefined when response.usage is a string', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
      usage: 'cached',
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect('usage' in r._meta).toBe(true);
    expect(r._meta.usage).toBeUndefined();
  });

  it('sets _meta.usage to undefined when response.usage is an array', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
      usage: [10, 20, 30],
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect('usage' in r._meta).toBe(true);
    expect(r._meta.usage).toBeUndefined();
  });

  it('sets _meta.usage to undefined when response.usage is boolean true', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.3 } },
      usage: true,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect('usage' in r._meta).toBe(true);
    expect(r._meta.usage).toBeUndefined();
  });

  it('omits _meta.usage entirely when response.usage is falsy (0)', async () => {
    // 0 is falsy → `response.usage ?` check is false → spread is {} →
    // _meta does NOT have a 'usage' key at all.
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
      usage: 0,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect('usage' in r._meta).toBe(false);
  });

  it('omits _meta.usage entirely when response.usage is empty string', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.4 } },
      usage: '',
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect('usage' in r._meta).toBe(false);
  });
});

// ===========================================================================
// 6–7. decide — answer entry as array
// ===========================================================================

describe('handleDecide — answer entry as array from upstream', () => {
  it('treats array answer entry via default switch case (type is undefined)', async () => {
    // typeof [] === 'object' and ![] is false, so the guard passes.
    // [].type is undefined → hits default switch case →
    // sanitizedAnswers gets { type: undefined }.
    const client = mockDecideClient({
      answers: {
        q1: [],
        q2: { type: 'noul', noul: 0.9 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    // q1 (array) should be present with only { type: 'unknown' }
    expect(r.structuredContent.answers.q1).toBeDefined();
    expect(r.structuredContent.answers.q1.type).toBe('unknown');
    // q2 should be properly handled
    expect(r.structuredContent.answers.q2).toBeDefined();
    expect(r.structuredContent.answers.q2.type).toBe('noul');
    // Summary should only contain q2 (q1 has unknown type, no line produced)
    expect(r.content[0].text).toContain('q2');
    expect(r.content[0].text).toContain('YES');
  });

  it('treats non-empty array answer entry via default switch case', async () => {
    // [0.5, 0.5] is truthy, typeof is 'object', passes guard.
    // [0.5, 0.5].type is undefined → default case → safeType = 'unknown'.
    const client = mockDecideClient({
      answers: {
        q1: [0.5, 0.5],
        q2: { type: 'noul', noul: 0.7 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    expect(r.structuredContent.answers.q1.type).toBe('unknown');
    expect(r.content[0].text).toContain('q2');
  });
});

// ===========================================================================
// 8. embed_text — usage divergence: cleaner pattern omits key entirely
// ===========================================================================

describe('handleEmbedText — usage handling with truthy non-object response.usage', () => {
  it('omits _meta.usage entirely when response.usage is a number', async () => {
    // embed_text first sanitizes: `const safeUsage = sanitizeUpstreamUsage(response.usage)`
    // then checks: `...(safeUsage ? { usage: safeUsage } : {})`.
    // sanitizer returns undefined for non-objects → safeUsage is falsy →
    // spread is {} → _meta does NOT have 'usage' key.
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/model',
      usage: 42,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccess;
    expect('usage' in r._meta).toBe(false);
  });

  it('omits _meta.usage entirely when response.usage is a string', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.2] }],
      model: 'test/model',
      usage: 'cached',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hi' }), client)) as EmbedSuccess;
    expect('usage' in r._meta).toBe(false);
  });

  it('omits _meta.usage entirely when response.usage is an array', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.3] }],
      model: 'test/model',
      usage: [10, 20],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccess;
    expect('usage' in r._meta).toBe(false);
  });

  it('omits _meta.usage entirely when response.usage is boolean true', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.4] }],
      model: 'test/model',
      usage: true,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccess;
    expect('usage' in r._meta).toBe(false);
  });
});
