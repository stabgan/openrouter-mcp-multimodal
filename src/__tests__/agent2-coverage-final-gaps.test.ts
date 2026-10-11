/**
 * Agent 2 — Final gap coverage for embed_text, decide, and classifyUpstreamError.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets (identified by diffing source branches vs existing tests):
 *
 * embed_text:
 *  1. MAX_TOTAL_INPUT_CHARS (10_000_000) aggregate limit exceeded
 *  2. Boundary: exactly at 10_000_000 chars (should pass)
 *  3. Malformed response — first embedding has no `embedding` field
 *  4. Malformed response — first embedding has empty `embedding` array
 *  5. Malformed response — first element is null
 *  6. Response data is non-array (string)
 *
 * decide:
 *  7. Answers is an array (not object) from API response
 *  8. Malformed answer entry (non-object) skipped in summary
 *  9. noul with NaN value defaults to P=0
 *  10. noul with Infinity value defaults to P=0
 *  11. Score answer with empty array in response (skipped)
 *  12. Score answer with all non-number values (maxVal stays -Infinity)
 *  13. Choice answer with empty choice object
 *
 * classifyUpstreamError:
 *  14. extractStatus with string code matching /^\d{3}$/ (e.g. "503")
 *  15. 5xx status + Retry-After header carries retry_after_seconds
 *  16. extractMessage with null/number input
 *  17. "insufficient credits" variant (distinct from "insufficient balance")
 *  18. "ssl routines" via message text (no nodeCode)
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { classifyUpstreamError } from '../tool-handlers/openrouter-errors.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: {
    code: string;
    details?: Record<string, unknown>;
    suggestions?: string[];
    retry_after_seconds?: number;
  };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  return {
    submitDecision: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

// ---------------------------------------------------------------------------
// 1–2. embed_text — MAX_TOTAL_INPUT_CHARS aggregate limit
// ---------------------------------------------------------------------------

describe('handleEmbedText — MAX_TOTAL_INPUT_CHARS (10_000_000)', () => {
  it('returns INVALID_INPUT when total chars across texts exceeds 10_000_000', async () => {
    // Each text is 99_999 chars (under per-text limit of 100_000).
    // 102 texts × 99_999 = 10_199_898 total > 10_000_000 aggregate limit.
    const singleText = 'a'.repeat(99_999);
    const texts = Array.from({ length: 102 }, () => singleText);
    const r = (await handleEmbedText(embedReq({ texts }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('Total input size');
    expect(r.content[0].text).toContain('10000000');
  });

  it('returns INVALID_INPUT when exactly one char over the aggregate limit', async () => {
    // 100 texts × 100_000 chars each = 10_000_000. Add 1 more text of 1 char.
    const fullText = 'x'.repeat(100_000);
    const texts = [...Array.from({ length: 100 }, () => fullText), 'y'];
    // Total: 100 * 100_000 + 1 = 10_000_001
    const r = (await handleEmbedText(embedReq({ texts }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('10000001');
  });

  it('accepts texts at exactly 10_000_000 total chars', async () => {
    // 100 texts × 100_000 chars each = exactly 10_000_000
    const fullText = 'z'.repeat(100_000);
    const texts = Array.from({ length: 100 }, () => fullText);
    const data = texts.map((_, i) => ({ index: i, embedding: [0.1] }));
    const client = mockEmbedClient({
      data,
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts }), client)) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect((r.structuredContent as { embeddings: unknown[] }).embeddings).toHaveLength(100);
  });
});

// ---------------------------------------------------------------------------
// 3–6. embed_text — Malformed upstream response shapes
// ---------------------------------------------------------------------------

describe('handleEmbedText — malformed embedding response shapes', () => {
  it('returns INTERNAL when first embedding has no embedding field', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0 }], // missing `embedding` field
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  it('returns INTERNAL when first embedding has empty embedding array', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [] }],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  it('returns INTERNAL when first element in data is null', async () => {
    const client = mockEmbedClient({
      data: [null],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  it('returns INTERNAL when first element has embedding as non-array', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: 'not-an-array' }],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  it('returns INTERNAL when data is a non-array truthy value', async () => {
    const client = mockEmbedClient({
      data: 'not-an-array',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });
});

// ---------------------------------------------------------------------------
// 7. decide — answers is an array instead of object
// ---------------------------------------------------------------------------

describe('handleDecide — malformed answers from API', () => {
  it('returns INTERNAL when answers is an array', async () => {
    const client = mockDecideClient({
      answers: [{ type: 'noul', noul: 0.5 }],
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No answers returned');
  });

  // 8. Malformed answer entry (non-object) is skipped
  it('skips malformed (non-object) answer entries in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: 'not-an-object',
        q2: { type: 'noul', noul: 0.9 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test1',
            criteria: { yes: 'y', no: 'n' },
          },
          q2: {
            type: 'noul',
            instructions: 'test2',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    // q1 should be skipped (not an object), q2 should appear
    const text = r.content[0].text;
    expect(text).toContain('q2');
    expect(text).toContain('YES');
    expect(text).toContain('90.0%');
  });

  it('skips null answer entries in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: null,
        q2: { type: 'noul', noul: 0.6 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test1',
            criteria: { yes: 'y', no: 'n' },
          },
          q2: {
            type: 'noul',
            instructions: 'test2',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    const text = r.content[0].text;
    expect(text).toContain('q2');
    // Only one line expected since q1 is skipped
    const lines = text.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 9–10. decide — noul with NaN/Infinity falls to P=0
// ---------------------------------------------------------------------------

describe('handleDecide — noul edge cases in response', () => {
  it('treats noul=NaN as P=0 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: NaN } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    // NaN is not finite, so prob defaults to 0 → NO at 0.0%
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('treats noul=Infinity as P=0 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: Infinity } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('treats noul as string (non-number) as P=0 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 'invalid' } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ---------------------------------------------------------------------------
// 11–13. decide — score/choice edge cases in response
// ---------------------------------------------------------------------------

describe('handleDecide — score edge cases in response', () => {
  it('skips score answer with empty array (no line in summary)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [] },
        q2: { type: 'noul', noul: 0.7 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['bad', 'good'],
          },
          q2: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    // Only q2 should appear (q1's empty score array is skipped by the length check)
    const lines = r.content[0].text.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
  });

  it('handles score with all non-number values (maxVal stays -Infinity, falls to index 0)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: ['bad', null, undefined] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['low', 'mid', 'high'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    // All values fail the typeof check, maxIdx stays 0
    // score[0] is 'bad' (not a number), so (score[maxIdx] ?? 0) * 100 = 0
    expect(r.content[0].text).toContain('level 1/3');
  });
});

describe('handleDecide — choice edge cases in response', () => {
  it('handles choice with empty choice object gracefully', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: {} },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick',
            criteria: { a: 'A', b: 'B' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    // sort on empty array gives undefined best → "?" fallback
    expect(r.content[0].text).toContain('?');
  });

  it('handles choice where all probabilities are zero', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: 0, b: 0, c: 0 } },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick',
            criteria: { a: 'A', b: 'B', c: 'C' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ---------------------------------------------------------------------------
// 14. classifyUpstreamError — extractStatus with string code /^\d{3}$/
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — extractStatus string code edge cases', () => {
  it('extracts status from string code "503"', () => {
    const err = { code: '503', message: 'Service unavailable' };
    const r = classifyUpstreamError(err);
    // 503 is >= 500, so maps to UPSTREAM_HTTP
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: 503 });
  });

  it('extracts status from string code "429"', () => {
    const err = { code: '429', message: 'Too many requests' };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('extracts status from string code "401"', () => {
    const err = { code: '401', message: 'Unauthorized' };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('does not treat long numeric string codes as HTTP status', () => {
    // "5030" does not match /^\d{3}$/, so no status is extracted
    const err = { code: '5030', message: 'Something unknown' };
    const r = classifyUpstreamError(err);
    // Falls through to generic UPSTREAM_HTTP (no status extracted)
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });
});

// ---------------------------------------------------------------------------
// 15. classifyUpstreamError — 5xx status with Retry-After header
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — 5xx with Retry-After', () => {
  it('carries retry_after_seconds for status 502 with Retry-After header', () => {
    const err = {
      status: 502,
      message: 'Bad Gateway',
      headers: { 'retry-after': '60' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: 502 });
    expect(r._meta.retry_after_seconds).toBe(60);
  });

  it('carries retry_after_seconds for status 503 with Retry-After', () => {
    const err = {
      status: 503,
      message: 'Service Unavailable',
      headers: new Headers({ 'retry-after': '30' }),
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.retry_after_seconds).toBe(30);
  });

  it('omits retry_after_seconds for 5xx without Retry-After header', () => {
    const err = { status: 500, message: 'Internal Server Error' };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.retry_after_seconds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 16. classifyUpstreamError — null/number input
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — non-Error non-object inputs', () => {
  it('handles null input gracefully', () => {
    const r = classifyUpstreamError(null);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('unknown error');
  });

  it('handles undefined input gracefully', () => {
    const r = classifyUpstreamError(undefined);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('unknown error');
  });

  it('handles string input as message', () => {
    const r = classifyUpstreamError('Something went wrong');
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Something went wrong');
  });

  it('handles number input gracefully', () => {
    const r = classifyUpstreamError(42);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });
});

// ---------------------------------------------------------------------------
// 17. classifyUpstreamError — "insufficient credits"
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — insufficient credits variant', () => {
  it('maps "insufficient credits" to UPSTREAM_REFUSED with credits reason', () => {
    const err = new Error('Account has insufficient credits for this request');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'credits' });
    expect(r._meta.suggestions!.some((s: string) => /credit/i.test(s))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 18. classifyUpstreamError — "ssl routines" via message text
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — ssl routines in message', () => {
  it('maps "ssl routines" in message (no nodeCode) to UPSTREAM_REFUSED with tls', () => {
    const err = new Error('error:141A318A:SSL routines:tls_process_ske_dhe:dh key too small');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });
});

// ---------------------------------------------------------------------------
// 19. classifyUpstreamError — extractStatus via nested error.code (number)
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — nested error.code as number', () => {
  it('extracts status from nested error.code number field', () => {
    const err = {
      message: 'OpenRouter API error',
      error: { code: 404, message: 'model not found' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
  });

  it('extracts status from nested error.code 401', () => {
    const err = {
      message: 'API error',
      error: { code: 401, message: 'unauthorized' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });
});

// ---------------------------------------------------------------------------
// 20. classifyUpstreamError — "invalid authentication" variant
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — invalid authentication variant', () => {
  it('maps "invalid authentication" message to INVALID_CREDENTIALS', () => {
    const err = new Error('invalid authentication token provided');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });
});

// ---------------------------------------------------------------------------
// 21. classifyUpstreamError — extractErrorType with error_type priority
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — error_type field priority', () => {
  it('uses error_type over type when both present', () => {
    const err = {
      status: 200, // not a typical error status, but error_type should override
      message: 'Something happened',
      error: { type: 'server_error', error_type: 'authentication', message: 'bad key' },
    };
    const r = classifyUpstreamError(err);
    // error_type=authentication should match isAuthFailure
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('falls back to type when error_type is absent', () => {
    const err = {
      status: 401,
      message: 'Something happened',
      error: { type: 'authentication_error', message: 'bad key' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });
});

// ---------------------------------------------------------------------------
// 22. classifyUpstreamError — extractMessage for non-Error object without message
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — extractMessage edge cases', () => {
  it('uses nested error.message when top-level message is missing', () => {
    const err = {
      error: { message: 'The inner error message' },
    };
    const r = classifyUpstreamError(err);
    // Falls through to generic handler since no status/keywords match
    expect(r.content[0].text).toContain('The inner error message');
  });

  it('uses nested string error when no message anywhere', () => {
    const err = {
      error: 'A raw string error from the API',
    };
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).toContain('A raw string error from the API');
  });

  it('returns "unknown error" for object without message or error', () => {
    const err = { status: 500, data: 'something' };
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).toContain('unknown error');
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });
});

// ---------------------------------------------------------------------------
// 23. classifyUpstreamError — contextMessage prefix
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — contextMessage prefix', () => {
  it('prepends contextMessage to the error text', () => {
    const err = new Error('model not found');
    const r = classifyUpstreamError(err, 'embed_text');
    expect(r.content[0].text).toContain('embed_text:');
    expect(r.content[0].text).toContain('model not found');
  });

  it('omits prefix when contextMessage is undefined', () => {
    const err = new Error('model not found');
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).not.toContain(':');
    expect(r.content[0].text).toBe('model not found');
  });
});
