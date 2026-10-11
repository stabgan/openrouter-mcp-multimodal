/**
 * Agent 2 — Deep coverage for untested code paths across multiple modules.
 *
 * Targets identified by static analysis of source vs existing tests:
 *
 * 1. classifyUpstreamError — extractNodeErrorCode cause-chain walking
 *    (OpenAI SDK wraps transport errors in `cause`)
 * 2. classifyUpstreamError — extractStatus with string code matching /^\d{3}$/
 * 3. classifyUpstreamError — extractStatus with nested error.code (number)
 * 4. classifyUpstreamError — extractMessage with Error + nested string error
 * 5. classifyUpstreamError — extractMessage with non-Error object shapes
 * 6. classifyUpstreamError — extractErrorType with error_type field priority
 * 7. buildBinaryToolResult — video kind produces resource content type
 * 8. buildBinaryToolResult — video kind with remoteUrl in resource URI
 * 9. buildBinaryToolResult — too-large with remoteUrl produces URL hint
 * 10. rerank — document.text extraction from { document: { text: "..." } }
 * 11. rerank — both score and relevance_score are NaN, falls to 0
 * 12. rerank — return_documents type validation (non-boolean)
 * 13. rerank — model type validation (non-string)
 * 14. rerank — documents exceeding MAX_DOCUMENTS (1000)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyUpstreamError } from '../tool-handlers/openrouter-errors.js';
import { buildBinaryToolResult } from '../tool-handlers/tool-result-payload.js';
import { handleRerankDocuments } from '../tool-handlers/rerank.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; details?: Record<string, unknown>; suggestions?: string[] };
};

function mockRerankClient(response: unknown, throws?: Error) {
  const rerank = vi.fn();
  if (throws) rerank.mockRejectedValue(throws);
  else rerank.mockResolvedValue(response);
  return { rerank } as unknown as OpenRouterAPIClient;
}

// ---------------------------------------------------------------------------
// 1. extractNodeErrorCode — cause chain walking
//
// The OpenAI SDK wraps transport errors: the outer Error has no code, but
// err.cause.code carries ETIMEDOUT / ECONNREFUSED / etc. The code walks
// up to two levels deep via the cause property.
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — cause chain walking (extractNodeErrorCode)', () => {
  it('classifies ETIMEDOUT from err.cause.code as UPSTREAM_TIMEOUT', () => {
    const inner = { code: 'ETIMEDOUT' };
    const err = Object.assign(new Error('Connection error'), { cause: inner });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('classifies ECONNREFUSED from err.cause.code as network error', () => {
    const inner = { code: 'ECONNREFUSED' };
    const err = Object.assign(new Error('fetch failed'), { cause: inner });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'network' });
  });

  it('classifies ENOTFOUND from err.cause.code as network error', () => {
    const inner = { code: 'ENOTFOUND' };
    const err = Object.assign(new Error('fetch failed'), { cause: inner });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'network' });
  });

  it('classifies ECONNRESET from err.cause.code as connection_reset', () => {
    const inner = { code: 'ECONNRESET' };
    const err = Object.assign(new Error('socket hang up'), { cause: inner });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'connection_reset' });
  });

  it('classifies EAI_AGAIN from err.cause.code as dns_transient', () => {
    const inner = { code: 'EAI_AGAIN' };
    const err = Object.assign(new Error('DNS lookup failed'), { cause: inner });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'dns_transient' });
  });

  it('classifies EPROTO from err.cause.code as tls error', () => {
    const inner = { code: 'EPROTO' };
    const err = Object.assign(new Error('TLS negotiation failed'), { cause: inner });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });

  it('prefers err.code over err.cause.code when both present', () => {
    const inner = { code: 'ENOTFOUND' };
    const err = Object.assign(new Error('timeout and dns'), {
      code: 'ETIMEDOUT',
      cause: inner,
    });
    const r = classifyUpstreamError(err);
    // ETIMEDOUT (from err.code) should win
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('ignores cause when cause.code is a 3-digit HTTP status string', () => {
    // The regex !/^\d{3}$/ skips "500" — it's an HTTP status, not a node code
    const inner = { code: '500' };
    const err = Object.assign(new Error('Something failed'), { cause: inner });
    const r = classifyUpstreamError(err);
    // Should NOT be classified via the cause chain; falls to generic path
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });

  it('ignores cause when cause.code is empty string', () => {
    const inner = { code: '' };
    const err = Object.assign(new Error('Unknown error'), { cause: inner });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });

  it('ignores cause when cause is not an object', () => {
    const err = Object.assign(new Error('Something wrong'), { cause: 'string-cause' });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });

  it('classifies UND_ERR_CONNECT_TIMEOUT from cause chain', () => {
    const inner = { code: 'UND_ERR_CONNECT_TIMEOUT' };
    const err = Object.assign(new Error('undici connect error'), { cause: inner });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });
});

// ---------------------------------------------------------------------------
// 2–3. extractStatus — string code and nested error.code
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — extractStatus edge cases', () => {
  it('extracts status from string code matching 3-digit pattern', () => {
    // e.code = "503" should be parsed as status 503
    const err = { code: '503', message: 'Service unavailable' };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: 503 });
  });

  it('extracts status from string code "429" and maps to rate limit', () => {
    const err = { code: '429', message: 'Too many requests' };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: 429, reason: 'rate_limit' });
  });

  it('extracts status from nested error.code when top-level has none', () => {
    const err = {
      message: 'Request failed',
      error: { code: 404, message: 'Model not found' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
  });

  it('extracts status from HTTP pattern in error message', () => {
    const err = new Error('POST /api/v1/chat failed: HTTP 502 Bad Gateway');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: 502 });
  });
});

// ---------------------------------------------------------------------------
// 4–5. extractMessage — nested error shapes
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — extractMessage with nested error shapes', () => {
  it('concatenates Error.message with nested error object message', () => {
    const err = Object.assign(new Error('API call failed'), {
      error: { message: 'rate limit exceeded', type: 'rate_limit_error' },
    });
    const r = classifyUpstreamError(err);
    // Should contain both messages joined by " — "
    expect(r.content[0].text).toContain('API call failed');
    expect(r.content[0].text).toContain('rate limit exceeded');
  });

  it('concatenates Error.message with nested string error', () => {
    const err = Object.assign(new Error('Request error'), {
      error: 'downstream service unavailable',
    });
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).toContain('Request error');
    expect(r.content[0].text).toContain('downstream service unavailable');
  });

  it('extracts message from non-Error object with message property', () => {
    const err = { message: 'model openai/gpt-999 does not exist', status: 404 };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
    expect(r.content[0].text).toContain('does not exist');
  });

  it('extracts message from non-Error object with nested error.message', () => {
    // Object without its own message, but has error.message
    const err = {
      status: 400,
      error: { message: 'Invalid model parameter', code: 400 },
    };
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).toContain('Invalid model parameter');
  });

  it('extracts message from non-Error object with nested string error', () => {
    const err = {
      status: 500,
      error: 'Internal processing failure',
    };
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).toContain('Internal processing failure');
  });

  it('falls back to "unknown error" for non-Error object without message or error', () => {
    const err = { status: 500 };
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).toContain('unknown error');
  });

  it('handles string error input directly', () => {
    const r = classifyUpstreamError('plain string error');
    expect(r.content[0].text).toContain('plain string error');
  });

  it('handles null error input with unknown error', () => {
    const r = classifyUpstreamError(null);
    expect(r.content[0].text).toContain('unknown error');
  });

  it('handles undefined error input with unknown error', () => {
    const r = classifyUpstreamError(undefined);
    expect(r.content[0].text).toContain('unknown error');
  });

  it('handles number error input with unknown error', () => {
    const r = classifyUpstreamError(42);
    expect(r.content[0].text).toContain('unknown error');
  });
});

// ---------------------------------------------------------------------------
// 6. extractErrorType — error_type vs type priority
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — extractErrorType priority', () => {
  it('prefers error_type over type when both present', () => {
    const err = {
      status: 401,
      message: 'failed',
      error: { error_type: 'authentication', type: 'api_error', message: 'bad key' },
    };
    const r = classifyUpstreamError(err);
    // error_type = 'authentication' should trigger INVALID_CREDENTIALS
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('falls back to type when error_type is absent', () => {
    const err = {
      status: 401,
      message: 'failed',
      error: { type: 'authentication_error', message: 'invalid key' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });
});

// ---------------------------------------------------------------------------
// 7–9. buildBinaryToolResult — video kind and remoteUrl paths
// ---------------------------------------------------------------------------

describe('buildBinaryToolResult — video resource content type', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('produces resource content type for video kind (not image or audio)', () => {
    const buf = Buffer.from('fake-video');
    const r = buildBinaryToolResult(
      { kind: 'video', buffer: buf, mimeType: 'video/mp4' },
      { inlineOnly: true, maxInlineBytes: 10000 },
    );
    expect(r.content).toHaveLength(1);
    expect(r.content[0]).toMatchObject({
      type: 'resource',
      resource: {
        uri: 'inline://openrouter-mcp-multimodal/video',
        mimeType: 'video/mp4',
        blob: buf.toString('base64'),
      },
    });
  });

  it('uses remoteUrl in resource URI when provided for video', () => {
    const buf = Buffer.from('video-bytes');
    const r = buildBinaryToolResult(
      { kind: 'video', buffer: buf, mimeType: 'video/mp4' },
      { inlineOnly: true, maxInlineBytes: 10000, remoteUrl: 'https://cdn.example.com/v.mp4' },
    );
    expect(r.content[0]).toMatchObject({
      type: 'resource',
      resource: {
        uri: 'https://cdn.example.com/v.mp4',
        mimeType: 'video/mp4',
      },
    });
  });

  it('produces image content type (not resource) for image kind', () => {
    const buf = Buffer.from('img-bytes');
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: buf, mimeType: 'image/png' },
      { inlineOnly: true, maxInlineBytes: 10000 },
    );
    expect(r.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(r.content[0]).not.toHaveProperty('resource');
  });

  it('produces audio content type (not resource) for audio kind', () => {
    const buf = Buffer.from('audio-bytes');
    const r = buildBinaryToolResult(
      { kind: 'audio', buffer: buf, mimeType: 'audio/wav' },
      { inlineOnly: true, maxInlineBytes: 10000 },
    );
    expect(r.content[0]).toMatchObject({ type: 'audio', mimeType: 'audio/wav' });
    expect(r.content[0]).not.toHaveProperty('resource');
  });

  it('includes text + resource when not using inlineOnly for video', () => {
    const buf = Buffer.from('small-video');
    const r = buildBinaryToolResult(
      { kind: 'video', buffer: buf, mimeType: 'video/mp4' },
      { maxInlineBytes: 10000, prefixText: 'Video ready' },
    );
    expect(r.content).toHaveLength(2);
    expect(r.content[0]).toMatchObject({ type: 'text', text: 'Video ready' });
    expect(r.content[1]).toMatchObject({ type: 'resource' });
  });
});

describe('buildBinaryToolResult — too-large with remoteUrl URL hint', () => {
  it('includes remoteUrl hint when buffer exceeds max inline', () => {
    const buf = Buffer.alloc(5000, 1);
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: buf, mimeType: 'image/png' },
      { maxInlineBytes: 100, remoteUrl: 'https://cdn.example.com/img.png' },
    );
    expect(r.content[0]).toMatchObject({ type: 'text' });
    expect((r.content[0] as { text: string }).text).toContain('Too large to inline');
    expect((r.content[0] as { text: string }).text).toContain(
      'URL: https://cdn.example.com/img.png',
    );
  });

  it('omits URL hint when remoteUrl is not provided (already tested, verify here)', () => {
    const buf = Buffer.alloc(5000, 1);
    const r = buildBinaryToolResult(
      { kind: 'audio', buffer: buf, mimeType: 'audio/mp3' },
      { maxInlineBytes: 100 },
    );
    expect((r.content[0] as { text: string }).text).toContain('Too large to inline');
    expect((r.content[0] as { text: string }).text).not.toContain('URL:');
  });

  it('uses custom summaryText for too-large instead of default', () => {
    const buf = Buffer.alloc(5000, 1);
    const r = buildBinaryToolResult(
      { kind: 'video', buffer: buf, mimeType: 'video/mp4' },
      { maxInlineBytes: 100, summaryText: 'Custom too-large message', remoteUrl: 'http://x.com' },
    );
    // summaryText overrides the default "Too large..." text
    expect((r.content[0] as { text: string }).text).toBe('Custom too-large message');
  });
});

// ---------------------------------------------------------------------------
// 10–14. rerank — document.text extraction, NaN scores, type validation,
//         max documents
// ---------------------------------------------------------------------------

describe('handleRerankDocuments — document.text extraction paths', () => {
  it('extracts document text from { document: { text: "..." } } shape', async () => {
    const client = mockRerankClient({
      results: [
        { index: 0, score: 0.9, document: { text: 'Extracted from object' } },
        { index: 1, score: 0.5, document: { text: 'Second doc' } },
      ],
    });
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: {
            query: 'test',
            documents: ['original doc 0', 'original doc 1'],
            return_documents: true,
          },
        },
      },
      client,
    );
    const results = (r as { structuredContent: { results: Array<{ document: string }> } })
      .structuredContent.results;
    expect(results[0].document).toBe('Extracted from object');
    expect(results[1].document).toBe('Second doc');
  });

  it('extracts document text from plain string document field', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.8, document: 'Plain string doc' }],
    });
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: {
            query: 'test',
            documents: ['original'],
            return_documents: true,
          },
        },
      },
      client,
    );
    const results = (r as { structuredContent: { results: Array<{ document: string }> } })
      .structuredContent.results;
    expect(results[0].document).toBe('Plain string doc');
  });

  it('falls back to original documents array when document field missing', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.7 }],
    });
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: {
            query: 'test',
            documents: ['fallback doc content'],
            return_documents: true,
          },
        },
      },
      client,
    );
    const results = (r as { structuredContent: { results: Array<{ document: string }> } })
      .structuredContent.results;
    expect(results[0].document).toBe('fallback doc content');
  });
});

describe('handleRerankDocuments — score normalization edge cases', () => {
  it('defaults to 0 when both score and relevance_score are undefined', async () => {
    const client = mockRerankClient({
      results: [{ index: 0 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['doc'] } } },
      client,
    );
    const results = (r as { structuredContent: { results: Array<{ score: number }> } })
      .structuredContent.results;
    expect(results[0].score).toBe(0);
  });

  it('falls back to relevance_score when score is NaN', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: NaN, relevance_score: 0.75 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['doc'] } } },
      client,
    );
    const results = (r as { structuredContent: { results: Array<{ score: number }> } })
      .structuredContent.results;
    expect(results[0].score).toBe(0.75);
  });

  it('falls back to relevance_score when score is Infinity', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: Infinity, relevance_score: 0.6 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['doc'] } } },
      client,
    );
    const results = (r as { structuredContent: { results: Array<{ score: number }> } })
      .structuredContent.results;
    expect(results[0].score).toBe(0.6);
  });

  it('defaults to 0 when both score and relevance_score are NaN', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: NaN, relevance_score: NaN }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['doc'] } } },
      client,
    );
    const results = (r as { structuredContent: { results: Array<{ score: number }> } })
      .structuredContent.results;
    expect(results[0].score).toBe(0);
  });

  it('falls back to relevance_score when score is non-number type', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 'high' as unknown as number, relevance_score: 0.9 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['doc'] } } },
      client,
    );
    const results = (r as { structuredContent: { results: Array<{ score: number }> } })
      .structuredContent.results;
    expect(results[0].score).toBe(0.9);
  });
});

describe('handleRerankDocuments — type validation gaps', () => {
  it('returns INVALID_INPUT for non-string model (number)', async () => {
    const client = mockRerankClient({});
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: {
            query: 'test',
            documents: ['doc'],
            model: 42 as unknown as string,
          },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('model');
  });

  it('returns INVALID_INPUT for non-boolean return_documents', async () => {
    const client = mockRerankClient({});
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: {
            query: 'test',
            documents: ['doc'],
            return_documents: 'true' as unknown as boolean,
          },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('return_documents');
  });

  it('returns INVALID_INPUT for non-boolean return_documents (number 1)', async () => {
    const client = mockRerankClient({});
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: {
            query: 'test',
            documents: ['doc'],
            return_documents: 1 as unknown as boolean,
          },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT for documents exceeding 1000 entries', async () => {
    const docs = Array.from({ length: 1001 }, (_, i) => `Document ${i}`);
    const client = mockRerankClient({});
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: docs } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('1001');
    expect((r as ErrorResult).content[0].text).toContain('1000');
  });

  it('allows exactly 1000 documents', async () => {
    const docs = Array.from({ length: 1000 }, (_, i) => `Document ${i}`);
    const results = docs.map((_, i) => ({ index: i, score: 1 - i / 1000 }));
    const client = mockRerankClient({ results });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: docs } } },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
  });

  it('returns INVALID_INPUT for whitespace-only query', async () => {
    const client = mockRerankClient({});
    const r = await handleRerankDocuments(
      { params: { arguments: { query: '   ', documents: ['doc'] } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when documents is not an array', async () => {
    const client = mockRerankClient({});
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: {
            query: 'test',
            documents: 'not an array' as unknown as string[],
          },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT for whitespace-only document', async () => {
    const client = mockRerankClient({});
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['valid', '   '] } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT for NaN top_n', async () => {
    const client = mockRerankClient({});
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'], top_n: NaN } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT for Infinity top_n', async () => {
    const client = mockRerankClient({});
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'], top_n: Infinity } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('handles missing arguments gracefully', async () => {
    const client = mockRerankClient({});
    const r = await handleRerankDocuments(
      { params: { arguments: undefined as unknown as { query: string; documents: string[] } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });
});

describe('handleRerankDocuments — response model fallback', () => {
  it('uses response.model when present', async () => {
    const client = mockRerankClient({
      model: 'cohere/rerank-v3.5',
      results: [{ index: 0, score: 0.8 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'] } } },
      client,
    );
    const sc = (r as { structuredContent: { model: string } }).structuredContent;
    expect(sc.model).toBe('cohere/rerank-v3.5');
  });

  it('falls back to effective model when response.model is missing', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.5 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'], model: 'custom/reranker' } } },
      client,
    );
    const sc = (r as { structuredContent: { model: string } }).structuredContent;
    expect(sc.model).toBe('custom/reranker');
  });

  it('falls back to default model when neither response.model nor request model', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.5 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'] } } },
      client,
    );
    const sc = (r as { structuredContent: { model: string } }).structuredContent;
    expect(sc.model).toBe('cohere/rerank-v3.5');
  });

  it('trims model whitespace before use', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.5 }],
    });
    await handleRerankDocuments(
      {
        params: {
          arguments: { query: 'test', documents: ['doc'], model: '  custom/reranker  ' },
        },
      },
      client,
    );
    expect(client.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'custom/reranker' }),
    );
  });

  it('passes return_documents: undefined when not explicitly true', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.5 }],
    });
    await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'], return_documents: false } } },
      client,
    );
    expect(client.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ return_documents: undefined }),
    );
  });

  it('includes response usage in meta when present', async () => {
    const client = mockRerankClient({
      results: [{ index: 0, score: 0.5 }],
      usage: { total_tokens: 42 },
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'] } } },
      client,
    );
    const meta = (r as { _meta: Record<string, unknown> })._meta;
    expect(meta.usage).toEqual({ total_tokens: 42 });
  });

  it('returns INTERNAL for negative index from upstream API', async () => {
    const client = mockRerankClient({
      results: [{ index: -1, score: 0.9 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'] } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INTERNAL');
  });

  it('returns INTERNAL for non-integer index from upstream API', async () => {
    const client = mockRerankClient({
      results: [{ index: 0.5, score: 0.9 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'test', documents: ['doc'] } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INTERNAL');
  });
});
