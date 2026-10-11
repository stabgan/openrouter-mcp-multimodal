/**
 * Agent 2 — Final coverage gaps: genuine untested code paths.
 *
 * Targets:
 *
 * provider-routing.ts:
 *  1. mergeProviderOptions non-object overrides guard (string)
 *  2. mergeProviderOptions non-object overrides guard (array)
 *  3. mergeProviderOptions non-object overrides guard (number)
 *  4. readProviderDefaults malformed JSON for OPENROUTER_PROVIDER_ONLY
 *
 * rerank.ts:
 *  5. API returns out-of-range document index → INTERNAL error
 *  6. API returns negative document index → INTERNAL error
 *  7. API returns non-integer document index → INTERNAL error
 *  8. model length exceeding MAX_MODEL_ID_LENGTH (256)
 *  9. top_n: NaN → INVALID_INPUT
 * 10. top_n: 1.5 (non-integer) → INVALID_INPUT
 * 11. top_n: -1 (negative) → INVALID_INPUT
 *
 * openrouter-errors.ts:
 * 12. errorType 'authentication_error' without status 401 (200 with error envelope)
 * 13. 'certificate is not yet valid' TLS variant
 * 14. extractMessage: non-Error object with string error field
 * 15. extractMessage: non-Error object with no message and nested error.message
 * 16. extractRetryAfterSeconds: Date.parse past date → returns 0
 * 17. looksLikeHtml with <!DOCTYPE prefix
 * 18. isAuthFailure: 403 + "invalid credentials"
 * 19. classifyUpstreamError with numeric-string error.code that matches 3-digit HTTP status
 *
 * embed-text.ts:
 * 20. dimensions: boolean type → INVALID_INPUT
 *
 * decide.ts:
 * 21. score criteria with exactly MAX_SCORE_LEVELS (100) accepted
 * 22. noul/choice criteria with exactly MAX_CRITERIA_ENTRIES (100) accepted
 * 23. state with array inside that has unsafe key → deep scan catches it
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  mergeProviderOptions,
  readProviderDefaults,
  type ProviderRoutingOptions,
} from '../tool-handlers/provider-routing.js';
import { classifyUpstreamError } from '../tool-handlers/openrouter-errors.js';
import { handleRerankDocuments } from '../tool-handlers/rerank.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  const createEmbeddings = vi.fn().mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  const submitDecision = vi.fn().mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function rerankReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleRerankDocuments>[0];
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
    criteria: { yes: 'Yes', no: 'No' },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–3. mergeProviderOptions — non-object overrides guard
// ═══════════════════════════════════════════════════════════════════════════

describe('mergeProviderOptions — non-object overrides guard', () => {
  it('returns defaults when overrides is a string', () => {
    const defaults: ProviderRoutingOptions = { sort: 'price', ignore: ['openai'] };
    const merged = mergeProviderOptions(
      defaults,
      'throughput' as unknown as ProviderRoutingOptions,
    );
    expect(merged).toEqual(defaults);
    expect(merged).not.toBe(defaults); // returns a copy
  });

  it('returns defaults when overrides is an array', () => {
    const defaults: ProviderRoutingOptions = { sort: 'latency' };
    const merged = mergeProviderOptions(defaults, [
      'anthropic',
    ] as unknown as ProviderRoutingOptions);
    expect(merged).toEqual(defaults);
  });

  it('returns defaults when overrides is a number', () => {
    const defaults: ProviderRoutingOptions = { allow_fallbacks: true };
    const merged = mergeProviderOptions(defaults, 42 as unknown as ProviderRoutingOptions);
    expect(merged).toEqual(defaults);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. readProviderDefaults — malformed JSON for OPENROUTER_PROVIDER_ONLY
// ═══════════════════════════════════════════════════════════════════════════

describe('readProviderDefaults — malformed OPENROUTER_PROVIDER_ONLY', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('drops malformed JSON for OPENROUTER_PROVIDER_ONLY and logs warning', () => {
    // Capture stderr to verify the warning was logged
    const _sink = process.stderr;
    const lines: string[] = [];
    const origWrite = _sink.write;
    _sink.write = ((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }) as typeof _sink.write;

    vi.stubEnv('OPENROUTER_PROVIDER_ONLY', '[not valid json');
    const d = readProviderDefaults();
    expect(d.only).toBeUndefined();

    _sink.write = origWrite;
    expect(lines.some((l) => l.includes('OPENROUTER_PROVIDER_ONLY ignored'))).toBe(true);
  });

  it('drops OPENROUTER_PROVIDER_ONLY when JSON is array of non-strings', () => {
    const _sink = process.stderr;
    const origWrite = _sink.write;
    _sink.write = (() => true) as typeof _sink.write;

    vi.stubEnv('OPENROUTER_PROVIDER_ONLY', '[1, 2, 3]');
    const d = readProviderDefaults();
    expect(d.only).toBeUndefined();

    _sink.write = origWrite;
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5–7. rerank — isValidDocumentIndex → INTERNAL error
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — invalid document index from API', () => {
  it('returns INTERNAL when API returns out-of-range index', async () => {
    const client = mockRerankClient({
      results: [{ index: 5, score: 0.9 }], // only 2 documents → index 5 invalid
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1', 'doc2'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('invalid document index');
  });

  it('returns INTERNAL when API returns negative index', async () => {
    const client = mockRerankClient({
      results: [{ index: -1, score: 0.5 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('invalid document index');
  });

  it('returns INTERNAL when API returns non-integer index', async () => {
    const client = mockRerankClient({
      results: [{ index: 0.5, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'] }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('invalid document index');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. rerank — model length exceeding MAX_MODEL_ID_LENGTH (256)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — model length validation', () => {
  it('returns INVALID_INPUT when model exceeds 256 chars', async () => {
    const longModel = 'm'.repeat(257);
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'], model: longModel }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('257');
  });

  it('accepts model at exactly 256 chars', async () => {
    const exactModel = 'a'.repeat(256);
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'], model: exactModel }),
      client,
    )) as SuccessResult;
    expect(r.content).toBeDefined();
    expect(r.structuredContent).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9–11. rerank — top_n validation edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleRerankDocuments — top_n validation edge cases', () => {
  it('returns INVALID_INPUT for top_n: NaN', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'], top_n: NaN }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for top_n: 1.5 (non-integer)', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'], top_n: 1.5 }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for top_n: -1 (negative)', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'], top_n: -1 }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('at least 1');
  });

  it('returns INVALID_INPUT for top_n: Infinity', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'], top_n: Infinity }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for top_n: "3" (string)', async () => {
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1'], top_n: '3' }),
      mockRerankClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('accepts top_n: 1 (minimum valid)', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.9 }],
    });
    const r = (await handleRerankDocuments(
      rerankReq({ query: 'test', documents: ['doc1', 'doc2'], top_n: 1 }),
      client,
    )) as SuccessResult;
    expect(r.content).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. classifyUpstreamError — error_type 'authentication_error' without 401
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyUpstreamError — error_type without matching status', () => {
  it('maps error_type="authentication_error" to INVALID_CREDENTIALS even with 200', () => {
    // Some SDK wrappers return 200 with an error envelope
    const err = {
      status: 200,
      message: 'API error',
      error: { type: 'authentication_error', message: 'Invalid key' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps error_type="authentication" to INVALID_CREDENTIALS without status', () => {
    const err = {
      message: 'Something went wrong',
      error: { error_type: 'authentication', message: 'No valid auth' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. classifyUpstreamError — 'certificate is not yet valid' TLS variant
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyUpstreamError — certificate is not yet valid', () => {
  it('maps "certificate is not yet valid" to UPSTREAM_REFUSED with tls reason', () => {
    const err = new Error('certificate is not yet valid');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14–15. classifyUpstreamError — extractMessage edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyUpstreamError — extractMessage edge paths', () => {
  it('extracts message from non-Error object with string error field', () => {
    const err = { error: 'Something broke in the upstream' };
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).toContain('Something broke in the upstream');
  });

  it('extracts message from non-Error object with nested error.message', () => {
    const err = { error: { message: 'Nested failure detail' } };
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).toContain('Nested failure detail');
  });

  it('falls back to "unknown error" for object with no message or error', () => {
    const err = { something: 'unexpected' };
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).toContain('unknown error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. extractRetryAfterSeconds — past date returns 0
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyUpstreamError — Retry-After past date returns 0', () => {
  it('treats past Retry-After date as 0 seconds', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    const err = {
      status: 429,
      message: 'rate limit',
      headers: new Headers({ 'retry-after': past }),
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.retry_after_seconds).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. classifyUpstreamError — looksLikeHtml with <!DOCTYPE prefix
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyUpstreamError — <!DOCTYPE HTML detection', () => {
  it('maps <!DOCTYPE html> error to UPSTREAM_HTTP with HTML page message', () => {
    const err = new Error('<!DOCTYPE html><html><body>502</body></html>');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('HTML error page');
  });

  it('maps <!doctype html> (lowercase) to UPSTREAM_HTTP', () => {
    const err = new Error('<!doctype html><html><body>503</body></html>');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('HTML error page');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. classifyUpstreamError — 403 + "invalid credentials"
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyUpstreamError — 403 with "invalid credentials"', () => {
  it('maps 403 + "invalid credentials" to INVALID_CREDENTIALS', () => {
    const err = Object.assign(new Error('invalid credentials for this endpoint'), { status: 403 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
    expect(r._meta.details).toEqual({ status: 403, reason: 'auth' });
  });

  it('maps 403 + "invalid api key" to INVALID_CREDENTIALS', () => {
    const err = Object.assign(new Error('invalid api key provided'), { status: 403 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. classifyUpstreamError — numeric string code ("429") as status
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyUpstreamError — string code matching HTTP status', () => {
  it('extracts 429 from string code "429" and classifies as rate limit', () => {
    const err = { code: '429', message: 'rate limited' };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual(expect.objectContaining({ status: 429, reason: 'rate_limit' }));
  });

  it('extracts 404 from string code "404" and classifies as model not found', () => {
    const err = { code: '404', message: 'not found' };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. embed_text — dimensions: boolean type
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — dimensions boolean type', () => {
  it('returns INVALID_INPUT for dimensions: true (boolean)', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: true }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for dimensions: false (boolean)', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: false }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 21. decide — score criteria at exactly MAX_SCORE_LEVELS (100) accepted
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score criteria at MAX_SCORE_LEVELS boundary', () => {
  it('accepts exactly 100 score levels', async () => {
    const criteria = Array.from({ length: 100 }, (_, i) => `level ${i}`);
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: Array.from({ length: 100 }, () => 0.01) } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: { type: 'score', instructions: 'rate', criteria } },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 22. decide — noul/choice criteria at exactly MAX_CRITERIA_ENTRIES (100)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — noul criteria at MAX_CRITERIA_ENTRIES boundary', () => {
  it('accepts exactly 100 criteria entries for choice type', async () => {
    const criteria: Record<string, string> = {};
    for (let i = 0; i < 100; i++) criteria[`opt${i}`] = `option ${i}`;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice: { opt0: 0.1 } } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: { type: 'choice', instructions: 'pick', criteria } },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 23. decide — state with array containing object with unsafe key
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — deep unsafe key in state array', () => {
  it('catches __proto__ inside an array element in state', async () => {
    const inner = Object.create(null);
    inner['__proto__'] = 'attack';
    inner['safe'] = 'value';
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQuestion() },
        state: { items: [inner] },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('unsafe key');
  });

  it('accepts state with deeply nested safe arrays', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQuestion() },
        state: { items: [{ nested: [{ deep: 'value' }] }] },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });
});
