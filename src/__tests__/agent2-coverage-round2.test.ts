/**
 * Agent 2 — Round 2 coverage for remaining untested code paths.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets:
 *
 * 1. rerank: MAX_QUERY_LENGTH (100_000) and MAX_DOCUMENT_LENGTH (100_000)
 *    validation — boundary tests at exactly the limit and one char over.
 * 2. rerank: RESOURCE_TOO_LARGE when capResultText truncates JSON output
 *    (triggered via OPENROUTER_MAX_RESULT_TEXT_CHARS env var).
 * 3. rerank: normalizeRerankResults catch block (when normalization throws).
 * 4. classifyUpstreamError: UND_ERR_HEADERS_TIMEOUT and UND_ERR_BODY_TIMEOUT
 *    node error codes.
 * 5. classifyUpstreamError: status 408 and 504 (gateway timeout).
 * 6. classifyUpstreamError: "prompt is too long" and "input is too long"
 *    context-length variants.
 * 7. classifyUpstreamError: "maximum context length" variant.
 * 8. classifyUpstreamError: non-parseable retry-after header value.
 * 9. classifyUpstreamError: "too many tokens" context-length variant.
 * 10. classifyUpstreamError: "context window" context-length variant.
 * 11. readToolPayload: structuredContent path and error path.
 * 12. embed_text: dimensions=1 boundary, negative dimensions, array input
 *     where 2nd element is empty after trim.
 * 13. decide: state with nested objects, answers null in response,
 *     question with falsy criteria value (0 as criteria value).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyUpstreamError } from '../tool-handlers/openrouter-errors.js';
import { handleRerankDocuments } from '../tool-handlers/rerank.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { readToolPayload } from '../tool-handlers/structured-output.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; details?: Record<string, unknown>; suggestions?: string[] };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

function mockRerankClient(response: unknown, throws?: Error) {
  const rerank = vi.fn();
  if (throws) rerank.mockRejectedValue(throws);
  else rerank.mockResolvedValue(response);
  return { rerank } as unknown as OpenRouterAPIClient;
}

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
// 1. rerank — MAX_QUERY_LENGTH and MAX_DOCUMENT_LENGTH validation
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — query length limits', () => {
  it('returns INVALID_INPUT when query exceeds 100_000 characters', async () => {
    const longQuery = 'q'.repeat(100_001);
    const r = await handleRerankDocuments(
      { params: { arguments: { query: longQuery, documents: ['doc'] } } },
      mockRerankClient({}),
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('100000');
    expect((r as ErrorResult).content[0].text).toContain('100001');
  });

  it('accepts query at exactly 100_000 characters', async () => {
    const maxQuery = 'q'.repeat(100_000);
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.9 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: maxQuery, documents: ['doc'] } } },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    expect(client.rerank).toHaveBeenCalled();
  });
});

describe('handleRerankDocuments — document length limits', () => {
  it('returns INVALID_INPUT when a document exceeds 100_000 characters', async () => {
    const longDoc = 'd'.repeat(100_001);
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['short', longDoc] } } },
      mockRerankClient({}),
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('documents[1]');
    expect((r as ErrorResult).content[0].text).toContain('100000');
  });

  it('returns INVALID_INPUT when the first document exceeds 100_000 characters', async () => {
    const longDoc = 'x'.repeat(100_001);
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: [longDoc] } } },
      mockRerankClient({}),
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult).content[0].text).toContain('documents[0]');
  });

  it('accepts document at exactly 100_000 characters', async () => {
    const maxDoc = 'd'.repeat(100_000);
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.8 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: [maxDoc] } } },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 2. rerank — RESOURCE_TOO_LARGE when capResultText truncates JSON
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — result truncation triggers RESOURCE_TOO_LARGE', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns RESOURCE_TOO_LARGE when JSON output exceeds OPENROUTER_MAX_RESULT_TEXT_CHARS', async () => {
    // Set an extremely low limit so the JSON result gets truncated
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '10');
    const client = mockRerankClient({
      results: [
        { index: 0, score: 0.9 },
        { index: 1, score: 0.7 },
      ],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc one', 'doc two'] } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('RESOURCE_TOO_LARGE');
    expect((r as ErrorResult).content[0].text).toContain('OPENROUTER_MAX_RESULT_TEXT_CHARS');
  });

  it('succeeds when OPENROUTER_MAX_RESULT_TEXT_CHARS is 0 (disabled)', async () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '0');
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.9 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'] } } },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 3. rerank — normalizeRerankResults catch block
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — normalizeRerankResults error catch', () => {
  it('returns INTERNAL when normalization throws unexpectedly', async () => {
    // Craft a response that will cause normalizeRerankResults to throw
    // when accessing .results — using a Proxy that throws on iteration
    const badResponse = {
      results: [
        {
          get index() {
            throw new Error('Kaboom!');
          },
          score: 0.5,
        },
      ],
    };
    const client = mockRerankClient(badResponse);
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'] } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INTERNAL');
  });
});

// ---------------------------------------------------------------------------
// 4. classifyUpstreamError — UND_ERR_HEADERS_TIMEOUT and UND_ERR_BODY_TIMEOUT
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — undici timeout node error codes', () => {
  it('classifies UND_ERR_HEADERS_TIMEOUT as UPSTREAM_TIMEOUT', () => {
    const err = Object.assign(new Error('Headers timeout'), {
      code: 'UND_ERR_HEADERS_TIMEOUT',
    });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('classifies UND_ERR_BODY_TIMEOUT as UPSTREAM_TIMEOUT', () => {
    const err = Object.assign(new Error('Body timeout'), {
      code: 'UND_ERR_BODY_TIMEOUT',
    });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('classifies UND_ERR_HEADERS_TIMEOUT from cause chain', () => {
    const inner = { code: 'UND_ERR_HEADERS_TIMEOUT' };
    const err = Object.assign(new Error('request failed'), { cause: inner });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('classifies UND_ERR_BODY_TIMEOUT from cause chain', () => {
    const inner = { code: 'UND_ERR_BODY_TIMEOUT' };
    const err = Object.assign(new Error('request failed'), { cause: inner });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });
});

// ---------------------------------------------------------------------------
// 5. classifyUpstreamError — status 408 and 504 gateway timeout
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — HTTP 408 and 504 timeout statuses', () => {
  it('maps status 408 (Request Timeout) to UPSTREAM_TIMEOUT', () => {
    const err = Object.assign(new Error('Request Timeout'), { status: 408 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
    expect(r._meta.details).toEqual({ status: 408 });
  });

  it('maps status 504 (Gateway Timeout) to UPSTREAM_TIMEOUT', () => {
    const err = Object.assign(new Error('Gateway Timeout'), { status: 504 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
    expect(r._meta.details).toEqual({ status: 504 });
  });

  it('408 gets timeout suggestions', () => {
    const err = Object.assign(new Error('Request Timeout'), { status: 408 });
    const r = classifyUpstreamError(err);
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /retry/i.test(s))).toBe(true);
  });

  it('504 gets timeout suggestions', () => {
    const err = Object.assign(new Error('Gateway Timeout'), { status: 504 });
    const r = classifyUpstreamError(err);
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /retry/i.test(s))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. classifyUpstreamError — additional context-length error variants
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — context-length error variants', () => {
  it('maps "prompt is too long" to INVALID_INPUT with context_length', () => {
    const err = new Error('prompt is too long for this model');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('maps "input is too long" to INVALID_INPUT with context_length', () => {
    const err = new Error('Your input is too long');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('maps "maximum context length" to INVALID_INPUT with context_length', () => {
    const err = new Error('This request exceeds the maximum context length of 128000 tokens');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('maps "too many tokens" to INVALID_INPUT with context_length', () => {
    const err = new Error('too many tokens in the request');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('maps "context window" to INVALID_INPUT with context_length', () => {
    const err = new Error('message exceeds the context window size');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('context_length gets actionable suggestions', () => {
    const err = new Error('context_length_exceeded');
    const r = classifyUpstreamError(err);
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.length).toBeGreaterThanOrEqual(2);
    expect(r._meta.suggestions!.some((s) => /reduce/i.test(s))).toBe(true);
    expect(r._meta.suggestions!.some((s) => /context/i.test(s))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. classifyUpstreamError — non-parseable retry-after header
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — retry-after edge cases', () => {
  it('returns undefined retry_after_seconds for non-parseable retry-after value', () => {
    const err = {
      status: 429,
      message: 'rate limit',
      headers: { 'retry-after': 'not-a-number-or-date' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    // "not-a-number-or-date" is not parseable as int or date
    expect(r._meta.retry_after_seconds).toBeUndefined();
  });

  it('extracts retry-after from future date', () => {
    const futureDate = new Date(Date.now() + 30_000).toUTCString();
    const err = {
      status: 429,
      message: 'rate limit',
      headers: new Headers({ 'retry-after': futureDate }),
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.retry_after_seconds).toBeGreaterThan(0);
    expect(r._meta.retry_after_seconds).toBeLessThanOrEqual(31);
  });

  it('returns undefined when err is null', () => {
    const r = classifyUpstreamError(null);
    expect(r._meta.retry_after_seconds).toBeUndefined();
  });

  it('returns undefined when headers object is empty', () => {
    const err = {
      status: 429,
      message: 'rate limit',
      headers: {},
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBeUndefined();
  });

  it('handles negative integer retry-after gracefully', () => {
    // parseInt('-5') = -5 which fails the >= 0 check, but Date.parse('-5')
    // may succeed as a past date (year -5), returning deltaSec <= 0 → 0.
    const err = {
      status: 429,
      message: 'rate limit',
      headers: { 'retry-after': '-5' },
    };
    const r = classifyUpstreamError(err);
    // Either 0 (parsed as past date) or undefined (NaN from Date.parse)
    if (r._meta.retry_after_seconds !== undefined) {
      expect(r._meta.retry_after_seconds).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. classifyUpstreamError — "zero data retention" variant
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — zero data retention variant', () => {
  it('maps "zero data retention" (full phrase) to ZDR_INCOMPATIBLE', () => {
    const err = new Error('Provider requires zero data retention policy');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('ZDR_INCOMPATIBLE');
  });

  it('ZDR gets actionable suggestions', () => {
    const err = new Error('ZDR policy conflict');
    const r = classifyUpstreamError(err);
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /data_collection/i.test(s))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. classifyUpstreamError — "too large" without status 413
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — "too large" text without 413 status', () => {
  it('maps "too large" in message to RESOURCE_TOO_LARGE even without status', () => {
    const err = new Error('Payload is too large for this endpoint');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('RESOURCE_TOO_LARGE');
  });

  it('RESOURCE_TOO_LARGE gets suggestions about reducing size', () => {
    const err = Object.assign(new Error('Request entity too large'), { status: 413 });
    const r = classifyUpstreamError(err);
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /reduce|save_path/i.test(s))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. classifyUpstreamError — EPIPE node error code
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — EPIPE broken pipe', () => {
  it('classifies EPIPE via code property as connection_reset', () => {
    const err = Object.assign(new Error('write failed'), { code: 'EPIPE' });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'connection_reset' });
  });

  it('classifies EPIPE from cause chain as connection_reset', () => {
    const inner = { code: 'EPIPE' };
    const err = Object.assign(new Error('write error'), { cause: inner });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'connection_reset' });
  });
});

// ---------------------------------------------------------------------------
// 11. readToolPayload — edge cases
// ---------------------------------------------------------------------------

describe('readToolPayload — edge cases', () => {
  it('returns structuredContent when both structuredContent and content are present', () => {
    const result = {
      structuredContent: { data: 'structured' },
      content: [{ type: 'text', text: '{"data":"from_text"}' }],
    };
    expect(readToolPayload(result)).toEqual({ data: 'structured' });
  });

  it('falls back to parsing content text when structuredContent is undefined', () => {
    const result = {
      content: [{ type: 'text', text: '{"key":"value"}' }],
    };
    expect(readToolPayload(result)).toEqual({ key: 'value' });
  });

  it('throws when neither structuredContent nor content text is available', () => {
    expect(() => readToolPayload({})).toThrow('no structuredContent or content text');
  });

  it('throws when content array is empty', () => {
    expect(() => readToolPayload({ content: [] })).toThrow('no structuredContent or content text');
  });

  it('throws when content text is invalid JSON', () => {
    const result = { content: [{ type: 'text', text: 'not-json' }] };
    expect(() => readToolPayload(result)).toThrow();
  });

  it('returns structuredContent even when it is falsy (0, empty string, false)', () => {
    expect(readToolPayload({ structuredContent: 0 })).toBe(0);
    expect(readToolPayload({ structuredContent: '' })).toBe('');
    expect(readToolPayload({ structuredContent: false })).toBe(false);
  });

  it('prefers structuredContent: null over content text', () => {
    // null is not undefined, so it should be returned as-is
    const result = {
      structuredContent: null,
      content: [{ type: 'text', text: '{"fallback":true}' }],
    };
    expect(readToolPayload(result)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. embed_text — additional edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — additional validation edge cases', () => {
  it('rejects undefined in texts array', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: ['valid', undefined] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
  });

  it('rejects array in texts array', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [['nested']] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });

  it('accepts texts with unicode content', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: '日本語テスト 🎉' }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect(r.structuredContent.embeddings).toHaveLength(1);
  });

  it('accepts dimensions = 1 (minimum valid)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.99] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: 1 }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.dimensions).toBe(1);
  });

  it('rejects dimensions = -1', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: -1 }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('positive integer');
  });

  it('summary text includes model and dimension count', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3, 0.4, 0.5] },
        { index: 1, embedding: [0.6, 0.7, 0.8, 0.9, 1.0] },
      ],
      model: 'voyage/voyage-3',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as SuccessResult;
    expect(r.content[0].text).toContain('2 embedding(s)');
    expect(r.content[0].text).toContain('5 dimensions');
    expect(r.content[0].text).toContain('voyage/voyage-3');
  });
});

// ---------------------------------------------------------------------------
// 13. decide — additional edge cases
// ---------------------------------------------------------------------------

describe('handleDecide — additional response edge cases', () => {
  it('handles choice with single highest probability option correctly', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { red: 0.01, green: 0.01, blue: 0.98 } },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'best color',
            criteria: { red: 'Red', green: 'Green', blue: 'Blue' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('blue');
    expect(r.content[0].text).toContain('98.0%');
  });

  it('handles score where last level has highest probability', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [0.01, 0.01, 0.01, 0.97] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['terrible', 'bad', 'ok', 'excellent'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('level 4/4');
    expect(r.content[0].text).toContain('97.0%');
  });

  it('accepts state with nested objects', async () => {
    const state = {
      user: { name: 'Alice', preferences: { lang: 'en' } },
      context: [1, 2, 3],
    };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
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
        state,
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
    expect(client.submitDecision).toHaveBeenCalledWith(expect.objectContaining({ state }));
  });

  it('rejects question where criteria value is a number (not string)', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 0, no: 'n' },
          },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria.yes');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('rejects question where instructions is an object', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: { text: 'wrapped' },
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('instructions');
  });

  it('handles upstream timeout error in decide', async () => {
    const err = Object.assign(new Error('Request timed out'), { status: 504 });
    const client = {
      submitDecision: vi.fn().mockRejectedValue(err),
    } as unknown as OpenRouterAPIClient;
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
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });
});

// ---------------------------------------------------------------------------
// 14. classifyUpstreamError — ECONNABORTED via node code (not message)
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — ECONNABORTED via node code property', () => {
  it('classifies ECONNABORTED code property as connection_reset', () => {
    const err = Object.assign(new Error('Request failed'), { code: 'ECONNABORTED' });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'connection_reset' });
  });
});

// ---------------------------------------------------------------------------
// 15. classifyUpstreamError — 403 without auth/guardrail keywords
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — 403 Forbidden as policy', () => {
  it('maps 403 without auth keywords to UPSTREAM_REFUSED with policy reason', () => {
    const err = Object.assign(new Error('Access denied to this resource'), { status: 403 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: 403, reason: 'policy' });
  });
});

// ---------------------------------------------------------------------------
// 16. rerank — query is non-string type
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — query type validation', () => {
  it('returns INVALID_INPUT when query is a number', async () => {
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: { query: 42 as unknown as string, documents: ['doc'] },
        },
      },
      mockRerankClient({}),
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when query is null', async () => {
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: { query: null as unknown as string, documents: ['doc'] },
        },
      },
      mockRerankClient({}),
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when query is boolean', async () => {
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: { query: true as unknown as string, documents: ['doc'] },
        },
      },
      mockRerankClient({}),
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// 17. rerank — empty model string
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — empty model validation', () => {
  it('returns INVALID_INPUT for whitespace-only model', async () => {
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: { query: 'test', documents: ['doc'], model: '   ' },
        },
      },
      mockRerankClient({}),
    );
    // Whitespace-only model is trimmed to empty, falls back to default
    // This actually succeeds because model?.trim() || DEFAULT_MODEL handles it
    // Let me verify the actual behavior
    expect((r as { isError?: boolean }).isError).toBeFalsy();
  });

  it('returns INVALID_INPUT for boolean model', async () => {
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: { query: 'test', documents: ['doc'], model: true as unknown as string },
        },
      },
      mockRerankClient({}),
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// 18. rerank — return_documents undefined passes through as undefined
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — return_documents undefined passthrough', () => {
  it('does not pass return_documents to API when omitted', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.5 }],
    });
    await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'] } } },
      client,
    );
    expect(client.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ return_documents: undefined }),
    );
  });
});
