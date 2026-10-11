/**
 * Agent 2 — Novel edge-case coverage for embed_text, decide, rerank,
 * classifyUpstreamError, and errors.ts.
 *
 * Targets (confirmed untested via exhaustive grep of all src/__tests__/):
 *
 * embed_text:
 *  1. Single string that is only unicode whitespace (non-ASCII) but trim() empties it
 *  2. Batch where element at index > 0 is whitespace-only (boundary index in error msg)
 *  3. Model provided as undefined explicitly (should use default, not error)
 *  4. dimensions=1 with batch request (minimum dimension with multi-text)
 *  5. response.data is explicitly undefined (not null, not missing — `undefined ?? []` = [])
 *
 * decide:
 *  6. State with nested null values (serializable, not objects — skip in deep scan)
 *  7. State with nested primitives (numbers, booleans) in deep scan
 *  8. State with array of nulls — hasDeepUnsafeKey should skip nulls
 *  9. Criteria object with exactly 2 entries (minimum boundary) for choice type
 * 10. Score criteria with empty string level (passes typeof but may be edge-y)
 *     → actually empty strings are allowed in criteria since they're not instructions
 *     → CORRECTION: score criteria[i] is a string but it doesn't check for empty trim
 * 11. Multiple questions: first valid, second has invalid type → error on second
 * 12. Answer entry that is a number (non-object) → skipped in summary
 * 13. Answer noul=0.0 → should be NO (not treated as missing)
 *
 * classifyUpstreamError:
 * 14. Error as a plain number → falls through to generic UPSTREAM_HTTP
 * 15. Error as undefined → message is "unknown error"
 * 16. Error with e.code as string "503" (3-digit numeric string) → extractStatus returns 503
 * 17. Error with `error` nested as string + Error instance → concatenated message
 * 18. "exceeds the model" context-length variant
 * 19. "ECONNABORTED" in message but NOT "operation was aborted" → connection_reset, not timeout
 * 20. Retry-After from record-style headers with "Retry-After" (capital R-A)
 * 21. Retry-After with non-parseable string → undefined
 * 22. isAuthFailure: 403 + "invalid credentials" → INVALID_CREDENTIALS
 * 23. isAuthFailure: 403 + "authentication" → INVALID_CREDENTIALS
 *
 * errors.ts:
 * 24. toolErrorFrom with undefined err → "unknown error"
 * 25. toolErrorFrom with a number err → "unknown error"
 * 26. toolError with empty suggestions array → suggestions not in _meta
 * 27. toolError with retry_after_seconds=0 → included in _meta
 * 28. toolError with very long message → truncated with '…'
 *
 * rerank:
 * 29. Score field takes precedence over relevance_score when both are present
 * 30. Document extraction from { document: { text: "..." } } object shape
 * 31. normalizeRerankResults: index is negative → INTERNAL
 * 32. normalizeRerankResults: index is NaN → INTERNAL
 * 33. Rerank with model that needs trimming (leading/trailing whitespace)
 * 34. Rerank query is only whitespace → INVALID_INPUT
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { handleRerankDocuments } from '../tool-handlers/rerank.js';
import { classifyUpstreamError } from '../tool-handlers/openrouter-errors.js';
import { toolError, toolErrorFrom, ErrorCode, sanitizeErrorMessage } from '../errors.js';
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

function mockRerankClient(response: unknown, throws?: Error) {
  const rerank = vi.fn();
  if (throws) rerank.mockRejectedValue(throws);
  else rerank.mockResolvedValue(response);
  return { rerank } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function rerankReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleRerankDocuments>[0];
}

function noulQ(instructions = 'Is it raining?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Yes it is', no: 'No it is not' },
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
// 1–5. embed_text — novel edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — novel edge cases', () => {
  it('rejects single unicode whitespace-only text (non-breaking space)', async () => {
    // \u00A0 is a non-breaking space — .trim() removes it in modern JS engines
    const r = (await handleEmbedText(
      embedReq({ texts: '\u00A0\u00A0\u00A0' }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('empty');
  });

  it('correctly identifies whitespace-only element at index 2 in batch', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: ['valid text', 'also valid', '   \t  '] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[2]');
    expect(r.content[0].text).toContain('empty');
  });

  it('uses default model when model is explicitly undefined', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
    });
    await handleEmbedText(embedReq({ texts: 'hello', model: undefined }), client);
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/text-embedding-3-small' }),
    );
  });

  it('accepts dimensions=1 with a batch of texts', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.5] },
        { index: 1, embedding: [0.6] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['hello', 'world'], dimensions: 1 }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect((r.structuredContent as { dimensions: number }).dimensions).toBe(1);
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 1 }),
    );
  });

  it('returns INTERNAL when response.data is explicitly undefined', async () => {
    const client = mockEmbedClient({ data: undefined });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6–13. decide — novel edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — state deep scan with non-object values', () => {
  it('accepts state with nested null values (hasDeepUnsafeKey skips non-objects)', async () => {
    const state = { data: { nested: null, value: 'ok' }, flag: null };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });

  it('accepts state with nested primitive values (numbers, booleans, strings)', async () => {
    const state = {
      count: 42,
      active: true,
      nested: { arr: [1, 'two', false, null], deep: { x: 0 } },
    };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });

  it('accepts state with array of nulls (deep scan skips null array elements)', async () => {
    const state = { items: [null, null, null] };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.9 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

describe('handleDecide — criteria boundary cases', () => {
  it('accepts choice criteria with exactly 2 entries (minimum)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: { a: 0.6, b: 0.4 } } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'choice', instructions: 'pick', criteria: { a: 'Option A', b: 'Option B' } },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });

  it('rejects when first question is valid but second has invalid type', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: { type: 'ranking', instructions: 'rank items', criteria: { a: 'x', b: 'y' } },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('q2');
    expect(r.content[0].text).toContain('noul, choice, score');
    expect(r.content[0].text).toContain('ranking');
  });
});

describe('handleDecide — response summary edge cases', () => {
  it('skips answer entry that is a number (non-object)', async () => {
    const client = mockDecideClient({
      answers: { q1: 42, q2: { type: 'noul', noul: 0.8 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ(), q2: noulQ() } }),
      client,
    )) as SuccessResult;
    // q1 is skipped (not object), q2 appears
    expect(r.content[0].text).toContain('q2');
    expect(r.content[0].text).toContain('YES');
  });

  it('correctly formats noul=0.0 as NO with 0.0%', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('handles noul=1.0 as YES with 100.0%', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 1.0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('YES');
    expect(r.content[0].text).toContain('100.0%');
  });

  it('handles score answer with single-element score array (length > 0 but 1)', async () => {
    // Even though criteria must have 2+ levels, the API response might return 1 score
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.95] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('level 1/1');
    expect(r.content[0].text).toContain('95.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14–23. classifyUpstreamError — novel edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyUpstreamError — exotic error inputs', () => {
  it('handles a plain number as error input', () => {
    const r = classifyUpstreamError(42);
    expect(r.isError).toBe(true);
    // A plain number has no message, status, or error type
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('unknown error');
  });

  it('handles undefined as error input', () => {
    const r = classifyUpstreamError(undefined);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('unknown error');
  });

  it('handles boolean true as error input', () => {
    const r = classifyUpstreamError(true);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });

  it('extracts status from 3-digit string code property (e.g. "503")', () => {
    const err = { message: 'Some error', code: '503' };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: 503 });
  });

  it('concatenates Error.message with nested string error field', () => {
    const err = Object.assign(new Error('API call failed'), {
      error: 'detailed: backend overloaded',
    });
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).toContain('API call failed');
    expect(r.content[0].text).toContain('detailed: backend overloaded');
  });
});

describe('classifyUpstreamError — context-length variant coverage', () => {
  it('maps "exceeds the model" to INVALID_INPUT with context_length reason', () => {
    const err = new Error('Request exceeds the model context capacity');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('maps "context length exceeded" (space variant) to INVALID_INPUT', () => {
    const err = new Error('Error: context length exceeded for this request');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('maps "token limit" to INVALID_INPUT with context_length reason', () => {
    const err = new Error('reached the token limit for this model');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });
});

describe('classifyUpstreamError — ECONNABORTED is connection_reset not timeout', () => {
  it('classifies ECONNABORTED without "operation was aborted" as connection_reset', () => {
    // ECONNABORTED check runs AFTER the timeout check — the timeout check
    // looks for "operation was aborted" but explicitly excludes ECONNABORTED
    const err = Object.assign(new Error('Connection was aborted by network'), {
      code: 'ECONNABORTED',
    });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'connection_reset' });
  });
});

describe('classifyUpstreamError — Retry-After from record-style headers', () => {
  it('reads Retry-After from record-style headers (capital case)', () => {
    const err = {
      status: 429,
      message: 'rate limited',
      headers: { 'Retry-After': '25' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBe(25);
  });

  it('reads retry-after from record-style headers (lowercase)', () => {
    const err = {
      status: 429,
      message: 'rate limited',
      headers: { 'retry-after': '15' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBe(15);
  });

  it('returns undefined retry_after_seconds for non-parseable Retry-After', () => {
    const err = {
      status: 429,
      message: 'rate limited',
      headers: { 'retry-after': 'not-a-date-or-number' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.retry_after_seconds).toBeUndefined();
  });
});

describe('classifyUpstreamError — auth 403 combinations', () => {
  it('maps 403 + "invalid credentials" to INVALID_CREDENTIALS', () => {
    const err = Object.assign(new Error('invalid credentials for this endpoint'), { status: 403 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
    expect(r._meta.details).toEqual({ status: 403, reason: 'auth' });
  });

  it('maps 403 + "authentication" to INVALID_CREDENTIALS', () => {
    const err = Object.assign(new Error('authentication required for this API'), { status: 403 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
    expect(r._meta.details).toEqual({ status: 403, reason: 'auth' });
  });

  it('maps 403 without auth keywords to UPSTREAM_REFUSED policy', () => {
    const err = Object.assign(new Error('access denied: region block'), { status: 403 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: 403, reason: 'policy' });
  });
});

describe('classifyUpstreamError — extractErrorType from nested error', () => {
  it('uses error_type field from nested error for auth classification', () => {
    const err = {
      message: 'Request failed',
      error: { error_type: 'authentication', message: 'bad key' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('uses type field from nested error when error_type is absent', () => {
    const err = {
      message: 'Request failed',
      error: { type: 'authentication_error', message: 'invalid key' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('classifyUpstreamError — insufficient credits variants', () => {
  it('maps "requires more credits" to UPSTREAM_REFUSED with credits reason', () => {
    const err = new Error('This model requires more credits than available');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'credits' });
  });

  it('maps status 402 to UPSTREAM_REFUSED with credits reason', () => {
    const err = Object.assign(new Error('Payment required'), { status: 402 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: 402, reason: 'credits' });
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s: string) => /credit/i.test(s))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 24–28. errors.ts — toolError and toolErrorFrom edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('toolErrorFrom — exotic err inputs', () => {
  it('handles undefined err as "unknown error"', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, undefined);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('unknown error');
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('handles a number as err (treated as unknown error)', () => {
    const r = toolErrorFrom(ErrorCode.UPSTREAM_HTTP, 42);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('unknown error');
  });

  it('handles null as err (treated as unknown error)', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, null);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('unknown error');
  });

  it('includes prefix when err is a string', () => {
    const r = toolErrorFrom(ErrorCode.INVALID_INPUT, 'bad data', 'Validation');
    expect(r.content[0].text).toContain('Validation: bad data');
  });

  it('includes prefix when err is an Error', () => {
    const r = toolErrorFrom(ErrorCode.UPSTREAM_HTTP, new Error('connection lost'), 'Fetch');
    expect(r.content[0].text).toContain('Fetch: connection lost');
  });
});

describe('toolError — options edge cases', () => {
  it('does not include suggestions in _meta when array is empty', () => {
    const r = toolError(ErrorCode.INVALID_INPUT, 'bad request', undefined, { suggestions: [] });
    expect(r._meta.suggestions).toBeUndefined();
  });

  it('includes retry_after_seconds=0 in _meta', () => {
    const r = toolError(ErrorCode.UPSTREAM_REFUSED, 'rate limited', undefined, {
      retry_after_seconds: 0,
    });
    expect(r._meta.retry_after_seconds).toBe(0);
  });

  it('truncates message exceeding 2048 chars with trailing …', () => {
    // Use non-base64 characters to avoid sanitization regex issues
    const longMessage = 'Error: ' + 'x'.repeat(2100);
    const r = toolError(ErrorCode.INTERNAL, longMessage);
    expect(r.content[0].text.length).toBeLessThanOrEqual(2049); // 2048 + '…'
    expect(r.content[0].text).toContain('…');
  });

  it('does not truncate message at exactly 2048 chars', () => {
    const exactMessage = 'x'.repeat(2048);
    const r = toolError(ErrorCode.INTERNAL, exactMessage);
    expect(r.content[0].text).toBe(exactMessage);
    expect(r.content[0].text).not.toContain('…');
  });

  it('includes details when provided', () => {
    const r = toolError(ErrorCode.INVALID_INPUT, 'oops', { foo: 'bar' });
    expect(r._meta.details).toEqual({ foo: 'bar' });
  });

  it('omits details when undefined', () => {
    const r = toolError(ErrorCode.INVALID_INPUT, 'oops');
    expect(r._meta.details).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 29–34. rerank — novel edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — score precedence and document extraction', () => {
  it('prefers score over relevance_score when both are present', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.95, relevance_score: 0.1 }],
    });
    const r = await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc one'] }),
      client,
    );
    const results = (r as SuccessResult).structuredContent.results as Array<{ score: number }>;
    expect(results[0].score).toBe(0.95);
  });

  it('falls back to relevance_score when score is undefined', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, relevance_score: 0.75 }],
    });
    const r = await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc one'] }),
      client,
    );
    const results = (r as SuccessResult).structuredContent.results as Array<{ score: number }>;
    expect(results[0].score).toBe(0.75);
  });

  it('falls back to 0 when both score and relevance_score are NaN', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: NaN, relevance_score: NaN }],
    });
    const r = await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc one'] }),
      client,
    );
    const results = (r as SuccessResult).structuredContent.results as Array<{ score: number }>;
    expect(results[0].score).toBe(0);
  });

  it('extracts document text from { document: { text: "..." } } shape', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.9, document: { text: 'extracted text' } }],
    });
    const r = await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['original text'], return_documents: true }),
      client,
    );
    const results = (r as SuccessResult).structuredContent.results as Array<{
      document: string;
    }>;
    expect(results[0].document).toBe('extracted text');
  });

  it('uses original document text when response document is missing', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.9 }],
    });
    const r = await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['original text'], return_documents: true }),
      client,
    );
    const results = (r as SuccessResult).structuredContent.results as Array<{
      document: string;
    }>;
    expect(results[0].document).toBe('original text');
  });

  it('extracts document text from string document field', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.8, document: 'inline string doc' }],
    });
    const r = await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['original'], return_documents: true }),
      client,
    );
    const results = (r as SuccessResult).structuredContent.results as Array<{
      document: string;
    }>;
    expect(results[0].document).toBe('inline string doc');
  });
});

describe('handleRerankDocuments — invalid index edge cases', () => {
  it('returns INTERNAL for negative index from API', async () => {
    const client = mockRerankClient({
      results: [{ index: -1, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['a', 'b'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('invalid document index');
  });

  it('returns INTERNAL for NaN index from API', async () => {
    const client = mockRerankClient({
      results: [{ index: NaN, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['a', 'b'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('returns INTERNAL for non-integer index from API', async () => {
    const client = mockRerankClient({
      results: [{ index: 1.5, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['a', 'b'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });
});

describe('handleRerankDocuments — model and query edge cases', () => {
  it('trims model whitespace before passing to API', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.5 }],
    });
    await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc'], model: '  cohere/rerank-v3.5  ' }),
      client,
    );
    expect(client.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'cohere/rerank-v3.5' }),
    );
  });

  it('returns INVALID_INPUT when query is whitespace-only', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: '   \t  ', documents: ['doc'] }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when documents is not an array', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: 'not-an-array' }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty array');
  });

  it('returns INVALID_INPUT for NaN top_n', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc'], top_n: NaN }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });

  it('handles missing arguments gracefully', async () => {
    const r = (await handleRerankDocuments(
      { params: { arguments: undefined as unknown as { query: string; documents: string[] } } },
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sanitizeErrorMessage — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeErrorMessage — additional edge cases', () => {
  it('redacts multiple Bearer tokens in same message', () => {
    const msg = 'Auth: Bearer token1 and also Bearer token2 in headers';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('token1');
    expect(result).not.toContain('token2');
    expect(result.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('redacts Authorization header with non-Bearer value', () => {
    const msg = 'Headers: Authorization: Basic dXNlcjpwYXNz Content-Type: application/json';
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain('Authorization: [REDACTED]');
    expect(result).not.toContain('Basic dXNlcjpwYXNz');
  });

  it('preserves short base64-like strings (< 256 chars)', () => {
    const shortB64 = 'aGVsbG8gd29ybGQ=';
    const msg = `Data: ${shortB64}`;
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain(shortB64);
  });

  it('handles message with only whitespace', () => {
    const result = sanitizeErrorMessage('   \t\n   ');
    expect(result).toBe('   \t\n   ');
  });
});
