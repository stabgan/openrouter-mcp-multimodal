/**
 * Agent 2 — Novel coverage gaps round 4.
 *
 * Targets confirmed untested via exhaustive grep across all 87 test files:
 *
 * embed_text — response edge cases:
 *  1. response.data is a number (42) → !Array.isArray(42) → INTERNAL
 *
 * decide — hasDeepUnsafeKey array traversal:
 *  2. `prototype` key inside array element in state (only __proto__ and
 *     constructor in arrays were previously tested; prototype was NOT)
 *  3. `prototype` key nested inside array→object→array chain in state
 *
 * decide — response summary edge cases:
 *  4. score answer where score property is a number (not array) → line skipped
 *  5. score answer where score property is an object (not array) → line skipped
 *  6. noul answer where noul is null → typeof null !== 'number' → defaults to 0
 *  7. score answer where score is a string → Array.isArray(string) false → skipped
 *
 * classifyUpstreamError — exotic err input types:
 *  8. err is undefined → "unknown error" → UPSTREAM_HTTP
 *  9. err is null → "unknown error" → UPSTREAM_HTTP
 * 10. err is a number (42) → "unknown error" → UPSTREAM_HTTP
 * 11. err is a boolean (true) → "unknown error" → UPSTREAM_HTTP
 * 12. err is plain object with non-string message (number) → "unknown error"
 * 13. err is plain object with non-string message + string error field → uses nested string
 * 14. err is plain object with no message, nested error has non-string message → "unknown error"
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { classifyUpstreamError } from '../tool-handlers/openrouter-errors.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; details?: Record<string, unknown> };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
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
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

function scoreQ(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. embed_text — response.data as a number
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response.data is a number', () => {
  it('returns INTERNAL when response.data is a number (42)', async () => {
    const client = mockEmbedClient({ data: 42 });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  it('returns INTERNAL when response.data is a negative number', async () => {
    const client = mockEmbedClient({ data: -1 });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('returns INTERNAL when response.data is zero', async () => {
    // data: 0 is falsy → data ?? [] gives [] → empty array → "No embeddings"
    const client = mockEmbedClient({ data: 0 });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2–3. decide — hasDeepUnsafeKey: `prototype` inside array in state
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — prototype key inside array elements in state', () => {
  it('rejects state with prototype key nested inside an array element', async () => {
    const inner = Object.create(null);
    inner['prototype'] = 'attack';
    inner['safe'] = 'value';
    // state = { list: [inner] } — inner has prototype as own property
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state: { list: [inner] } }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('prototype');
  });

  it('rejects prototype key in array→object→array chain in state', async () => {
    const leaf = Object.create(null);
    leaf['prototype'] = 'deep attack';
    leaf['ok'] = 'fine';
    // state = { data: [{ nested: [leaf] }] }
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQ() },
        state: { data: [{ nested: [leaf] }] },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('prototype');
  });

  it('accepts state with arrays containing no prototype keys', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQ() },
        state: {
          items: [
            { name: 'a', tags: ['x', 'y'] },
            { name: 'b', nested: { deep: [1, 2, 3] } },
          ],
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4–7. decide — response summary: score/noul non-standard property shapes
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score answer with non-array score property', () => {
  it('skips score answer when score is a number (not array) in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: 0.5 },
        q2: { type: 'noul', noul: 0.8 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ(), q2: noulQ() } }),
      client,
    )) as SuccessResult;
    // q1 line skipped (score is number, not array)
    // q2 should appear
    expect(r.content[0].text).toContain('q2');
    expect(r.content[0].text).toContain('YES');
    // q1 should NOT produce a line with level info
    expect(r.content[0].text).not.toContain('level');
  });

  it('skips score answer when score is an object (not array) in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: { value: 0.5 } },
        q2: { type: 'noul', noul: 0.9 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ(), q2: noulQ() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('q2');
    expect(r.content[0].text).not.toContain('level');
  });

  it('skips score answer when score is a string (not array) in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: 'high' },
        q2: { type: 'noul', noul: 0.7 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ(), q2: noulQ() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('q2');
    expect(r.content[0].text).not.toContain('level');
  });
});

describe('handleDecide — noul answer with null noul value', () => {
  it('treats noul=null as P=0 (NO at 0.0%)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: null } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    // typeof null === 'object' (not 'number') → prob defaults to 0 → NO
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8–11. classifyUpstreamError — exotic primitive err inputs
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyUpstreamError — primitive err values', () => {
  it('classifies undefined err as UPSTREAM_HTTP with "unknown error"', () => {
    const r = classifyUpstreamError(undefined);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('unknown error');
  });

  it('classifies null err as UPSTREAM_HTTP with "unknown error"', () => {
    const r = classifyUpstreamError(null);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('unknown error');
  });

  it('classifies number err (42) as UPSTREAM_HTTP with "unknown error"', () => {
    const r = classifyUpstreamError(42);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('unknown error');
  });

  it('classifies boolean err (true) as UPSTREAM_HTTP with "unknown error"', () => {
    const r = classifyUpstreamError(true);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('unknown error');
  });

  it('preserves context label with primitive err', () => {
    const r = classifyUpstreamError(undefined, 'embed_text');
    expect(r.content[0].text).toContain('embed_text');
    expect(r.content[0].text).toContain('unknown error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12–14. classifyUpstreamError — plain object with non-string message
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyUpstreamError — plain object with non-string message', () => {
  it('falls to "unknown error" when message is a number (42)', () => {
    const err = { message: 42 };
    const r = classifyUpstreamError(err);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('unknown error');
  });

  it('uses nested string error field when message is non-string', () => {
    const err = { message: 42, error: 'Something broke in the API' };
    const r = classifyUpstreamError(err);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Something broke in the API');
  });

  it('uses nested error.message when top-level message is non-string', () => {
    const err = { message: false, error: { message: 'Nested error detail' } };
    const r = classifyUpstreamError(err);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Nested error detail');
  });

  it('falls to "unknown error" when both message and nested error are non-string', () => {
    const err = { message: 42, error: { message: 99 } };
    const r = classifyUpstreamError(err);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('unknown error');
  });

  it('falls to "unknown error" when message is null and no error field', () => {
    const err = { message: null };
    const r = classifyUpstreamError(err);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('unknown error');
  });
});
