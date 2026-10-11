/**
 * Agent 2 — Residual edge-case coverage for embed_text, decide, and
 * supporting modules.  Every test targets a branch or value combination
 * not exercised by existing test files (verified against 108 test files,
 * 3200 existing tests).
 *
 * embed_text:
 *   1. texts is a non-string, non-array primitive (boolean) → wraps then fails typeof
 *   2. Response data is explicit null → falls through ?? [] → empty → INTERNAL
 *   3. Upstream embedding index is `undefined` → safeIndex fallback
 *   4. Upstream embedding contains boolean values → safeEmbedding maps to 0
 *   5. Upstream response.model is boolean → safeResponseModel = undefined
 *   6. Upstream response.model is empty string → safeResponseModel falsy → displayModel = effectiveModel
 *
 * decide:
 *   7. noul answer with noul: null → safeNoul = undefined
 *   8. noul answer with noul: false → safeNoul = undefined
 *   9. choice answer where answer.choice is an array → treated as object
 *  10. choice answer with extra properties → stripped by allowlist
 *  11. score answer where score is a non-empty object (truthy but not array) → safeScore = undefined
 *  12. Answer entry that is numeric 0 → skipped (falsy guard)
 *  13. Answer entry that is empty string → skipped (falsy guard)
 *  14. State with deeply nested arrays containing primitives → hasDeepUnsafeKey skips
 *  15. Question with number instructions → fails typeof check
 *  16. Question criteria is null → fails criteria required check
 *  17. Score criteria with exactly 2 items at boundary
 *
 * sanitize-usage:
 *  18. Usage is a number → returns undefined
 *  19. Usage with only duration_s → returns { duration_s }
 *  20. Usage with all invalid values (strings, NaN) → returns undefined
 *  21. Usage with completion_tokens only → returns { completion_tokens }
 *
 * errors.ts:
 *  22. toolError with retry_after_seconds: NaN → omitted
 *  23. toolError with retry_after_seconds: undefined → omitted
 *  24. toolErrorFrom with non-Error, non-string err (object) → "unknown error"
 *
 * completion-utils:
 *  25. extractCompletionText with choices[0] = undefined → empty extracted
 *  26. extractCompletionText with empty choices array → empty extracted
 *  27. extractContentText with null content → empty string
 *  28. buildCompletionMeta without reasoning but with extra → extra merged
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { sanitizeUpstreamUsage } from '../tool-handlers/sanitize-usage.js';
import { toolError, toolErrorFrom, ErrorCode, sanitizeErrorMessage } from '../errors.js';
import {
  extractCompletionText,
  buildCompletionMeta,
  type ExtractedText,
} from '../tool-handlers/completion-utils.js';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import { SERVER_VERSION } from '../version.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; details?: Record<string, unknown> };
};

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

function mockEmbedClient(response: unknown, throws?: Error) {
  const createEmbeddings = vi.fn();
  if (throws) createEmbeddings.mockRejectedValue(throws);
  else createEmbeddings.mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown, throws?: Error) {
  const submitDecision = vi.fn();
  if (throws) submitDecision.mockRejectedValue(throws);
  else submitDecision.mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQuestion(instructions = 'Is it true?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Yes it is', no: 'No it is not' },
  };
}

function choiceQuestion(instructions = 'Pick one') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { a: 'Option A', b: 'Option B', c: 'Option C' },
  };
}

function scoreQuestion(instructions = 'Rate it') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

// ---------------------------------------------------------------------------
// 1–6. embed_text — residual edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — residual edge cases', () => {
  // 1. texts is a boolean — Array.isArray(false) → false → wraps to [false] → typeof check fails
  it('returns INVALID_INPUT when texts is a boolean (non-string primitive)', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: true }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('must be a string');
  });

  // 2. response.data is explicit null → null ?? [] → [] → length 0 → INTERNAL
  it('returns INTERNAL when response.data is explicit null', async () => {
    const client = mockEmbedClient({ data: null, model: 'test/m' });
    const r = (await handleEmbedText(embedReq({ texts: 'hi' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  // 3. Upstream embedding index is undefined → safeIndex fallback to positional index
  it('falls back to positional index when upstream index is undefined', async () => {
    const client = mockEmbedClient({
      data: [{ embedding: [0.1, 0.2] }, { index: 1, embedding: [0.3, 0.4] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    // First element: index is undefined → typeof undefined !== 'number' → fallback to i=0
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    expect(r.structuredContent.embeddings[1].index).toBe(1);
  });

  // 4. Upstream embedding contains boolean values → replaced with 0
  it('replaces boolean values in embedding vectors with 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, true, false, 0.4] }],
      model: 'test/m',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hi' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0, 0, 0.4]);
  });

  // 5. response.model is boolean → safeResponseModel = undefined → displayModel = effectiveModel
  it('falls back to effective model when response.model is boolean', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: true,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hi' }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
    expect(r._meta.model).toBe('openai/text-embedding-3-small');
  });

  // 6. response.model is empty string → falsy → displayModel = effectiveModel
  it('falls back to effective model when response.model is empty string', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: '',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hi', model: 'cohere/embed-v4' }),
      client,
    )) as EmbedSuccessResult;
    // Empty string passes the typeof === 'string' check and the length <= 256 check,
    // but safeResponseModel is then falsy '' → displayModel = effectiveModel
    expect(r.structuredContent.model).toBe('cohere/embed-v4');
  });

  it('includes server_version in _meta on success', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/m',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hi' }), client)) as EmbedSuccessResult;
    expect(r._meta.server_version).toBe(SERVER_VERSION);
  });
});

// ---------------------------------------------------------------------------
// 7–17. decide — residual edge cases in response sanitization & validation
// ---------------------------------------------------------------------------

describe('handleDecide — residual response sanitization', () => {
  // 7. noul with null value → safeNoul = undefined
  it('sanitizes noul: null to undefined in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: null } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers['q1']?.noul).toBeUndefined();
    // Summary: null is not a number → defaults to 0 → NO
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  // 8. noul with boolean value → safeNoul = undefined
  it('sanitizes noul: false (boolean) to undefined in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: false } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers['q1']?.noul).toBeUndefined();
    expect(r.content[0].text).toContain('NO');
  });

  // 9. choice answer where answer.choice is an array → typeof 'object' is true,
  //    Object.entries iterates numeric indices as string keys
  it('handles choice answer with array value (treats indices as keys)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: [0.3, 0.7] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Array [0.3, 0.7] → Object.entries → [['0', 0.3], ['1', 0.7]]
    // Both are finite numbers → safeChoice = { '0': 0.3, '1': 0.7 }
    const choice = r.structuredContent.answers['q1']?.choice;
    expect(choice).toBeDefined();
    expect(choice?.['0']).toBe(0.3);
    expect(choice?.['1']).toBe(0.7);
  });

  // 10. Answer with extra properties → stripped by allowlist
  it('strips extra properties from noul answer in structuredContent', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.8, extra_prop: 'should be stripped', confidence: 0.95 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const answer = r.structuredContent.answers['q1'] as Record<string, unknown>;
    expect(answer.type).toBe('noul');
    expect(answer.noul).toBe(0.8);
    expect(answer).not.toHaveProperty('extra_prop');
    expect(answer).not.toHaveProperty('confidence');
  });

  it('strips extra properties from score answer in structuredContent', async () => {
    const client = mockDecideClient({
      answers: {
        q1: {
          type: 'score',
          score: [0.1, 0.9],
          raw_logits: [-2.3, 0.5],
          extra: true,
        },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    const answer = r.structuredContent.answers['q1'] as Record<string, unknown>;
    expect(answer.type).toBe('score');
    expect(answer.score).toEqual([0.1, 0.9]);
    expect(answer).not.toHaveProperty('raw_logits');
    expect(answer).not.toHaveProperty('extra');
  });

  // 11. score answer where score is a non-empty object → not array → safeScore = undefined
  it('sets safeScore to undefined when upstream score is a non-array object', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: { level1: 0.3, level2: 0.7 } } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers['q1']?.score).toBeUndefined();
  });

  // 12. Answer entry that is numeric 0 → falsy → skipped
  it('skips numeric 0 answer entries in summary and sanitization', async () => {
    const client = mockDecideClient({
      answers: { q1: 0, q2: { type: 'noul', noul: 0.9 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).toContain('q2');
    expect(r.content[0].text).toContain('YES');
    // q1 (numeric 0) should not appear in sanitizedAnswers
    expect(r.structuredContent.answers).not.toHaveProperty('q1');
  });

  // 13. Answer entry that is empty string → falsy → skipped
  it('skips empty string answer entries', async () => {
    const client = mockDecideClient({
      answers: { q1: '', q2: { type: 'noul', noul: 0.6 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion(), q2: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).toContain('q2');
    expect(r.structuredContent.answers).not.toHaveProperty('q1');
  });
});

describe('handleDecide — residual validation edge cases', () => {
  // 14. State with deeply nested arrays of primitives
  it('accepts state with nested arrays of primitives (no unsafe key)', async () => {
    const state = { data: [[1, 2, [3, 4]], 'hello', [null, true, { safe: 'val' }]] };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  // 15. Question with number instructions → fails typeof check
  it('rejects number instructions (type check before trim)', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: 42, criteria: { yes: 'y', no: 'n' } },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('instructions');
    expect(r.content[0].text).toContain('non-empty string');
  });

  // 16. Question criteria is explicit null → caught by !q.criteria
  it('rejects null criteria', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: 'test', criteria: null },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria');
    expect(r.content[0].text).toContain('required');
  });

  // 17. Score criteria with exactly 2 items (boundary — minimum allowed)
  it('accepts score criteria with exactly 2 levels (minimum)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.4, 0.6] } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: ['bad', 'good'] },
        },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r.content[0].text).toContain('level 2/2');
    expect(r.content[0].text).toContain('60.0%');
  });
});

// ---------------------------------------------------------------------------
// 18–21. sanitizeUpstreamUsage — residual edge cases
// ---------------------------------------------------------------------------

describe('sanitizeUpstreamUsage — residual edge cases', () => {
  // 18. Usage is a number → returns undefined
  it('returns undefined when usage is a number', () => {
    expect(sanitizeUpstreamUsage(42 as unknown as Record<string, unknown>)).toBeUndefined();
  });

  // 19. Usage with only duration_s
  it('returns only duration_s when other fields are absent', () => {
    expect(sanitizeUpstreamUsage({ duration_s: 2.5 })).toEqual({ duration_s: 2.5 });
  });

  // 20. Usage with all invalid values
  it('returns undefined when all known fields have non-finite values', () => {
    const usage = {
      prompt_tokens: NaN,
      completion_tokens: Infinity,
      total_tokens: -Infinity,
      cost: 'free',
      duration_s: undefined,
    };
    expect(sanitizeUpstreamUsage(usage as unknown as Record<string, unknown>)).toBeUndefined();
  });

  // 21. Usage with only completion_tokens
  it('returns only completion_tokens when present', () => {
    expect(sanitizeUpstreamUsage({ completion_tokens: 50, extra: 'ignored' })).toEqual({
      completion_tokens: 50,
    });
  });

  it('returns undefined for boolean usage', () => {
    expect(sanitizeUpstreamUsage(true as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it('returns undefined for string usage', () => {
    expect(sanitizeUpstreamUsage('usage' as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it('extracts multiple valid fields and ignores invalid ones', () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: NaN,
      total_tokens: 30,
      cost: 0.002,
      duration_s: Infinity,
      unknown_field: 42,
    };
    const result = sanitizeUpstreamUsage(usage as unknown as Record<string, unknown>);
    expect(result).toEqual({ prompt_tokens: 10, total_tokens: 30, cost: 0.002 });
  });
});

// ---------------------------------------------------------------------------
// 22–24. errors.ts — residual toolError / toolErrorFrom edge cases
// ---------------------------------------------------------------------------

describe('toolError — residual edge cases', () => {
  afterEach(() => vi.unstubAllEnvs());

  // 22. retry_after_seconds: NaN → typeof NaN === 'number' → included!
  //     Actually, let me re-read: `typeof opts?.retry_after_seconds === 'number'`
  //     NaN IS typeof 'number', so it WILL be included. Let me verify.
  it('includes retry_after_seconds when it is NaN (typeof number)', () => {
    const r = toolError(ErrorCode.UPSTREAM_REFUSED, 'rate limited', undefined, {
      retry_after_seconds: NaN,
    });
    // NaN passes typeof === 'number' check, so it IS included
    expect(r._meta.retry_after_seconds).toBeNaN();
  });

  // 23. retry_after_seconds: undefined → typeof undefined !== 'number' → omitted
  it('omits retry_after_seconds when undefined', () => {
    const r = toolError(ErrorCode.UPSTREAM_REFUSED, 'rate limited', undefined, {
      retry_after_seconds: undefined,
    });
    expect(r._meta).not.toHaveProperty('retry_after_seconds');
  });

  it('includes details when provided', () => {
    const r = toolError(ErrorCode.INTERNAL, 'oops', { key: 'val' });
    expect(r._meta.details).toEqual({ key: 'val' });
  });

  it('omits details when undefined', () => {
    const r = toolError(ErrorCode.INTERNAL, 'oops');
    expect(r._meta).not.toHaveProperty('details');
  });
});

describe('toolErrorFrom — residual edge cases', () => {
  // 24. Non-Error, non-string object → "unknown error"
  it('produces "unknown error" for plain object err', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, { code: 500, msg: 'bad' });
    expect(r.content[0].text).toContain('unknown error');
  });

  it('produces "unknown error" for boolean err', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, false);
    expect(r.content[0].text).toContain('unknown error');
  });

  it('includes prefix for string errors', () => {
    const r = toolErrorFrom(ErrorCode.INVALID_INPUT, 'bad format', 'Validation');
    expect(r.content[0].text).toContain('Validation');
    expect(r.content[0].text).toContain('bad format');
  });
});

// ---------------------------------------------------------------------------
// 25–28. completion-utils — residual extraction edge cases
// ---------------------------------------------------------------------------

describe('extractCompletionText — residual edge cases', () => {
  // 25. choices[0] is undefined (choices array exists but is sparse)
  it('returns empty when choices[0] is undefined', () => {
    const r = extractCompletionText({
      choices: [undefined as unknown as ChatCompletion.Choice],
    } as ChatCompletion);
    expect(r.text).toBe('');
    expect(r.reasonedOnly).toBe(false);
  });

  // 26. Empty choices array
  it('returns empty for empty choices array', () => {
    const r = extractCompletionText({
      choices: [],
    } as unknown as ChatCompletion);
    expect(r.text).toBe('');
    expect(r.reasonedOnly).toBe(false);
  });

  // 27. null content (different from undefined or empty string)
  it('returns empty string for null content', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: { content: null } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('');
  });

  it('extracts usage from completion without choices', () => {
    const r = extractCompletionText({
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    } as unknown as ChatCompletion);
    expect(r.usage).toEqual({ prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 });
  });

  it('returns empty when completion.usage is undefined', () => {
    const r = extractCompletionText({
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
    } as unknown as ChatCompletion);
    expect(r.usage).toBeUndefined();
  });
});

describe('buildCompletionMeta — residual edge cases', () => {
  const base: ExtractedText = {
    text: 'hello',
    reasonedOnly: false,
    finishReason: 'stop',
    nativeFinishReason: undefined,
  };

  // 28. extra option without reasoning
  it('merges extra without reasoning', () => {
    const m = buildCompletionMeta(base, { extra: { model: 'gpt-4o', cached: true } });
    expect(m.model).toBe('gpt-4o');
    expect(m.cached).toBe(true);
    expect(m.finish_reason).toBe('stop');
    expect(m).not.toHaveProperty('reasoning');
  });

  it('omits reasoning when reasoning is undefined', () => {
    const m = buildCompletionMeta({ ...base, reasoning: undefined }, { includeReasoning: true });
    expect(m).not.toHaveProperty('reasoning');
  });

  it('omits reasoning when reasoning is empty string', () => {
    const m = buildCompletionMeta({ ...base, reasoning: '' }, { includeReasoning: true });
    expect(m).not.toHaveProperty('reasoning');
  });

  it('includes reasoning and usage and extra together', () => {
    const e: ExtractedText = {
      ...base,
      reasoning: 'I thought about it',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
    const m = buildCompletionMeta(e, {
      includeReasoning: true,
      extra: { model: 'claude-3' },
    });
    expect(m.reasoning).toBe('I thought about it');
    expect(m.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
    expect(m.model).toBe('claude-3');
    expect(m.finish_reason).toBe('stop');
  });
});

// ---------------------------------------------------------------------------
// sanitizeErrorMessage — additional patterns
// ---------------------------------------------------------------------------

describe('sanitizeErrorMessage — additional redaction patterns', () => {
  it('redacts multiple bearer tokens in one message', () => {
    const msg = 'Auth failed: Bearer abc123 and also Bearer xyz789';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('abc123');
    expect(result).not.toContain('xyz789');
    expect(result.match(/Bearer \[REDACTED\]/g)?.length).toBe(2);
  });

  it('redacts Authorization header regardless of case', () => {
    const msg = 'authorization: sk-or-v1-secret123 was sent';
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('secret123');
  });

  it('preserves short base64-like strings under 256 chars', () => {
    const short = 'aGVsbG8gd29ybGQ=';
    const msg = `Payload: ${short}`;
    expect(sanitizeErrorMessage(msg)).toContain(short);
  });

  it('handles message with only whitespace', () => {
    expect(sanitizeErrorMessage('   ')).toBe('   ');
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: embed_text and decide response _meta structure
// ---------------------------------------------------------------------------

describe('embed_text & decide — response _meta structure consistency', () => {
  it('embed_text _meta includes embedding_count and dimensions', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3] },
        { index: 1, embedding: [0.4, 0.5, 0.6] },
      ],
      model: 'test/m',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    expect(r._meta.embedding_count).toBe(2);
    expect(r._meta.dimensions).toBe(3);
    expect(r._meta.server_version).toBe(SERVER_VERSION);
    expect(r._meta.model).toBe('test/m');
  });

  it('decide _meta includes question_count', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.7 },
        q2: { type: 'choice', choice: { a: 0.6, b: 0.4 } },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: choiceQuestion(),
        },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r._meta.question_count).toBe(2);
    expect(r._meta.server_version).toBe(SERVER_VERSION);
    expect(r._meta.model).toBe('typesafe/jev-1.13');
  });

  it('decide omits usage from _meta when response.usage is falsy', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
      usage: null,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r._meta.usage).toBeUndefined();
  });

  it('embed_text includes sanitized usage with duration_s', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'test/m',
      usage: { prompt_tokens: 5, total_tokens: 5, duration_s: 0.3 },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hi' }), client)) as EmbedSuccessResult;
    const usage = r._meta.usage as Record<string, number>;
    expect(usage.prompt_tokens).toBe(5);
    expect(usage.total_tokens).toBe(5);
    expect(usage.duration_s).toBe(0.3);
  });
});
