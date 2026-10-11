/**
 * Agent 2 — Coverage for genuinely untested code paths in embed_text and decide.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets (confirmed untested via exhaustive grep of all src/__tests__/):
 *
 * decide — hasDeepUnsafeKey array traversal:
 *  1. Unsafe key (__proto__) nested inside an array element in state
 *  2. Unsafe key (constructor) nested inside an array element in state
 *  3. Unsafe key (prototype) nested inside an array → object → array chain
 *  4. Safe state with deeply nested arrays (no unsafe keys) passes validation
 *
 * decide — hasDeepUnsafeKey depth limit (MAX_STATE_NESTING_DEPTH = 32):
 *  5. Unsafe key at exactly depth 32 (wrapper levels = 32) is caught
 *  6. Unsafe key beyond depth 32 (wrapper levels = 33) escapes detection
 *  7. Deeply nested safe state (no unsafe keys) at depth 40+ passes
 *
 * decide — choice answer with Infinity/-Infinity values:
 *  8. Choice with Infinity values — filtered by Number.isFinite
 *  9. Choice with -Infinity values — filtered by Number.isFinite
 * 10. Choice with mixed Infinity + valid values — only valid value wins
 * 11. Choice with all Infinity/-Infinity — shows "?" fallback (all filtered)
 */
import { describe, it, expect, vi } from 'vitest';
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

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: { answers: Record<string, unknown> };
  _meta: Record<string, unknown>;
};

function mockApiClient(response: unknown) {
  const submitDecision = vi.fn().mockResolvedValue(response);
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

/**
 * Build a nested object with `levels` wrapper levels and `leaf` at the bottom.
 * E.g., buildNestedState(2, { __proto__: 'x' }) →
 *   { n0: { n1: { __proto__: 'x' } } }
 */
function buildNestedState(levels: number, leaf: Record<string, unknown>): Record<string, unknown> {
  let current: Record<string, unknown> = leaf;
  for (let i = levels - 1; i >= 0; i--) {
    current = { [`n${i}`]: current };
  }
  return current;
}

// ---------------------------------------------------------------------------
// 1–4. hasDeepUnsafeKey — array traversal
// ---------------------------------------------------------------------------

describe('handleDecide — hasDeepUnsafeKey array traversal in state', () => {
  it('rejects state with __proto__ nested inside an array element', async () => {
    const inner = Object.create(null);
    inner['__proto__'] = 'attack';
    inner['safe'] = 'value';
    const state = { items: [inner] };
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('__proto__');
  });

  it('rejects state with constructor key inside an array element', async () => {
    const inner = Object.create(null);
    inner['constructor'] = 'attack';
    inner['data'] = 'value';
    const state = { records: [{ ok: true }, inner] };
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('constructor');
  });

  it('rejects state with prototype key deep inside array → object → array chain', async () => {
    const inner = Object.create(null);
    inner['prototype'] = 'polluted';
    inner['x'] = 1;
    // state.list[0].nested[0] has unsafe key
    const state = { list: [{ nested: [inner] }] };
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
    expect(r.content[0].text).toContain('prototype');
  });

  it('accepts state with deeply nested arrays but no unsafe keys', async () => {
    const state = {
      matrix: [[{ a: 1, b: [{ c: 2 }] }], [{ d: 3 }]],
      tags: ['safe', 'also-safe'],
    };
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
    });
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
    expect(r.content[0].text).toContain('YES');
  });
});

// ---------------------------------------------------------------------------
// 5–7. hasDeepUnsafeKey — depth limit (MAX_STATE_NESTING_DEPTH = 32)
// ---------------------------------------------------------------------------

describe('handleDecide — hasDeepUnsafeKey depth limit', () => {
  it('catches unsafe key at exactly depth 32 (32 wrapper levels)', async () => {
    // 32 wrapper objects + leaf with __proto__ → depth reaches 32 when
    // checking the leaf's keys.  32 > 32 is false, so it's still scanned.
    const leaf = Object.create(null);
    leaf['__proto__'] = 'attack';
    leaf['ok'] = true;
    const state = buildNestedState(32, leaf);
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('does NOT catch unsafe key beyond depth 32 (33 wrapper levels)', async () => {
    // 33 wrapper objects + leaf → depth reaches 33 when processing the leaf.
    // 33 > 32 is true, so the function returns null without checking keys.
    // This is intentional: the depth cap prevents stack overflow on
    // adversarially deep structures.
    const leaf = Object.create(null);
    leaf['__proto__'] = 'attack';
    leaf['ok'] = true;
    const state = buildNestedState(33, leaf);
    // The state is valid JSON and under the size limit, so it passes
    // validation because the depth cap prevents scanning that deep.
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
    });
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as SuccessResult;
    // The request succeeds because the unsafe key is too deep to detect.
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('accepts deeply nested safe state (40 levels, no unsafe keys)', async () => {
    const leaf = { value: 'deep but safe' };
    const state = buildNestedState(40, leaf);
    const client = mockApiClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      req({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 8–11. choice answer with Infinity / -Infinity values
// ---------------------------------------------------------------------------

describe('handleDecide — choice answer with Infinity values in response', () => {
  it('filters out Infinity values from choice (Number.isFinite is false)', async () => {
    const client = mockApiClient({
      answers: {
        q1: { type: 'choice', choice: { a: Infinity, b: 0.6 } },
      },
    });
    const r = (await handleDecide(
      req({ questions: { q1: choiceQuestion() } }),
      client,
    )) as SuccessResult;
    // Infinity is filtered, b=0.6 wins
    expect(r.content[0].text).toContain('b');
    expect(r.content[0].text).toContain('60.0%');
  });

  it('filters out -Infinity values from choice', async () => {
    const client = mockApiClient({
      answers: {
        q1: { type: 'choice', choice: { a: -Infinity, b: 0.3 } },
      },
    });
    const r = (await handleDecide(
      req({ questions: { q1: choiceQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('b');
    expect(r.content[0].text).toContain('30.0%');
  });

  it('picks valid value when mixed with Infinity and -Infinity', async () => {
    const client = mockApiClient({
      answers: {
        q1: {
          type: 'choice',
          choice: { a: Infinity, b: -Infinity, c: 0.9, d: NaN },
        },
      },
    });
    const r = (await handleDecide(
      req({ questions: { q1: choiceQuestion() } }),
      client,
    )) as SuccessResult;
    // Only c=0.9 is finite
    expect(r.content[0].text).toContain('c');
    expect(r.content[0].text).toContain('90.0%');
  });

  it('shows "?" fallback when all choice values are Infinity/-Infinity', async () => {
    const client = mockApiClient({
      answers: {
        q1: { type: 'choice', choice: { a: Infinity, b: -Infinity } },
      },
    });
    const r = (await handleDecide(
      req({ questions: { q1: choiceQuestion() } }),
      client,
    )) as SuccessResult;
    // All filtered out → best is undefined → "?" at 0.0%
    expect(r.content[0].text).toContain('?');
    expect(r.content[0].text).toContain('0.0%');
  });
});
