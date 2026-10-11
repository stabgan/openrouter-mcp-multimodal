/**
 * Agent 2 — Comprehensive coverage for untested branches in:
 *
 * 1. sanitizeErrorMessage (errors.ts): redaction patterns, truncation, pre-truncation
 * 2. classifyUpstreamError (openrouter-errors.ts): remaining TLS variants,
 *    auth heuristics, retry-after extraction from nested headers, "operation was
 *    aborted" with ECONNABORTED (should NOT be timeout), guardrail variants
 * 3. embed_text edge cases: API call with single string converts to array
 * 4. decide edge cases: state=undefined accepted, mixed question types summary
 * 5. toolErrorFrom edge cases: null/undefined inputs, prefix with non-Error
 */
import { describe, it, expect, vi } from 'vitest';
import { sanitizeErrorMessage, toolErrorFrom, ErrorCode } from '../errors.js';
import { classifyUpstreamError } from '../tool-handlers/openrouter-errors.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
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

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  return { submitDecision: vi.fn().mockResolvedValue(response) } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

// ---------------------------------------------------------------------------
// sanitizeErrorMessage — redaction patterns
// ---------------------------------------------------------------------------
describe('sanitizeErrorMessage — redaction patterns', () => {
  it('redacts Bearer tokens from error messages', () => {
    const msg = 'Request failed with Bearer sk-or-v1-abc123xyz in the Authorization header';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('sk-or-v1-abc123xyz');
    expect(result).toContain('Bearer [REDACTED]');
  });

  it('redacts sk-or-v* style API keys', () => {
    const msg = 'Invalid key: sk-or-v1-abcdefghijklmnopqrstuvwxyz';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('sk-or-v1-abcdefghijklmnopqrstuvwxyz');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts sk-* style API keys (generic OpenAI format)', () => {
    const msg = 'Authentication failed for sk-abcdefghijklmnopqrstuvwxyz';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts Authorization header values', () => {
    const msg = 'Header dump: Authorization: Bearer sk-secret-key-here';
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain('Authorization: [REDACTED]');
  });

  it('redacts data URLs with base64 payloads', () => {
    const b64 = 'A'.repeat(100);
    const msg = `Failed to process data:image/png;base64,${b64} due to size`;
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain('[REDACTED data-url]');
    expect(result).not.toContain(b64);
  });

  it('redacts large bare base64 blobs (>=256 chars)', () => {
    const blob = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.repeat(5);
    expect(blob.length).toBeGreaterThan(256);
    const msg = `Data: ${blob} end`;
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain('[REDACTED base64');
    expect(result).not.toContain(blob);
  });

  it('does not redact short base64 strings (<256 chars)', () => {
    const short = 'aGVsbG8=';
    const msg = `Payload: ${short}`;
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain(short);
  });

  it('truncates messages exceeding MAX_SANITIZED_ERROR_LENGTH (2048)', () => {
    // Use characters that won't match the base64 redaction regex (needs non-base64 chars)
    const msg = 'Error! '.repeat(500); // ~3500 chars, contains spaces and '!'
    const result = sanitizeErrorMessage(msg);
    expect(result.length).toBeLessThan(msg.length);
    expect(result).toContain('truncated');
    expect(result).toContain('chars omitted');
  });

  it('pre-truncates very large inputs before running regex', () => {
    // MAX_SANITIZE_INPUT_LENGTH = 2048 * 4 = 8192
    // Use non-base64 characters to avoid redaction
    const msg = 'Error! '.repeat(2000); // ~14000 chars
    const result = sanitizeErrorMessage(msg);
    // Should still produce output without error, truncated
    expect(result.length).toBeLessThan(14000);
  });

  it('handles empty string without error', () => {
    expect(sanitizeErrorMessage('')).toBe('');
  });

  it('passes through normal messages unchanged', () => {
    const msg = 'Model not found: openai/gpt-4o';
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — remaining TLS certificate variants
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — additional TLS variants', () => {
  it('maps CERT_NOT_YET_VALID to UPSTREAM_REFUSED with tls reason', () => {
    const err = new Error('CERT_NOT_YET_VALID');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });

  it('maps CERT_SIGNATURE_FAILURE to UPSTREAM_REFUSED with tls reason', () => {
    const err = new Error('CERT_SIGNATURE_FAILURE during handshake');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });

  it('maps CERT_REJECTED to UPSTREAM_REFUSED with tls reason', () => {
    const err = new Error('CERT_REJECTED by trust store');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });

  it('maps "certificate is not yet valid" to UPSTREAM_REFUSED with tls', () => {
    const err = new Error('The certificate is not yet valid');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — auth heuristic edge cases
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — auth heuristic edge cases', () => {
  it('maps "authentication failed" message to INVALID_CREDENTIALS', () => {
    const err = new Error('authentication failed for the provided key');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps "user not found" to INVALID_CREDENTIALS', () => {
    const err = new Error('user not found in system');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps "no auth credentials" to INVALID_CREDENTIALS', () => {
    const err = new Error('no auth credentials provided');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps "missing api key" to INVALID_CREDENTIALS', () => {
    const err = new Error('missing api key in request');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps 403 + "invalid credentials" to INVALID_CREDENTIALS', () => {
    const err = Object.assign(new Error('invalid credentials for this resource'), { status: 403 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps 403 + "authentication" to INVALID_CREDENTIALS', () => {
    const err = Object.assign(new Error('authentication required for this endpoint'), {
      status: 403,
    });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps errorType=authentication to INVALID_CREDENTIALS', () => {
    const err = {
      status: 401,
      message: 'something went wrong',
      error: { type: 'authentication', message: 'bad key' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — guardrail/policy variants
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — guardrail/policy variants', () => {
  it('maps "blocked:" prefix to UPSTREAM_REFUSED with policy reason', () => {
    const err = new Error('blocked: content moderation triggered');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'policy' });
  });

  it('maps "request blocked" to UPSTREAM_REFUSED with policy reason', () => {
    const err = new Error('request blocked by safety system');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'policy' });
  });

  it('maps "guardrail" to UPSTREAM_REFUSED with policy reason', () => {
    const err = new Error('Guardrail triggered: input not allowed');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'policy' });
  });

  it('maps "prompt injection" to UPSTREAM_REFUSED with policy reason', () => {
    const err = new Error('prompt injection detected');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'policy' });
  });

  it('maps "moderation" to UPSTREAM_REFUSED with policy reason', () => {
    const err = new Error('Content moderation flagged this input');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'policy' });
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — "operation was aborted" + ECONNABORTED edge case
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — abort vs connection abort', () => {
  it('treats "operation was aborted" with ECONNABORTED code as connection_reset, not timeout', () => {
    // This is a key edge case: the message says "aborted" but the code is ECONNABORTED
    // which means the socket was interrupted, not a timeout.
    const err = Object.assign(new Error('The operation was aborted'), { code: 'ECONNABORTED' });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'connection_reset' });
  });

  it('treats "operation was aborted" without ECONNABORTED as UPSTREAM_TIMEOUT', () => {
    const err = new Error('The operation was aborted');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — Retry-After extraction from nested headers
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — retry-after from nested response.headers', () => {
  it('extracts retry-after from response.headers (SDK-style)', () => {
    const err = {
      status: 429,
      message: 'rate limit',
      response: { headers: new Headers({ 'retry-after': '45' }) },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBe(45);
  });

  it('extracts Retry-After from record-style headers (case-sensitive fallback)', () => {
    const err = {
      status: 429,
      message: 'rate limit',
      headers: { 'Retry-After': '20' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBe(20);
  });

  it('extracts retry-after from record-style headers (lowercase)', () => {
    const err = {
      status: 429,
      message: 'rate limit',
      headers: { 'retry-after': '15' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBe(15);
  });

  it('returns undefined retry_after_seconds when no Retry-After header', () => {
    const err = { status: 429, message: 'rate limit' };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBeUndefined();
  });

  it('handles Retry-After date in the past (returns 0)', () => {
    const pastDate = new Date(Date.now() - 60000).toUTCString();
    const err = {
      status: 429,
      message: 'rate limit',
      headers: new Headers({ 'retry-after': pastDate }),
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — insufficient balance variants
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — insufficient balance variants', () => {
  it('maps "insufficient balance" to UPSTREAM_REFUSED with credits reason', () => {
    const err = new Error('insufficient balance for this request');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'credits' });
  });

  it('maps "requires more credits" to UPSTREAM_REFUSED with credits reason', () => {
    const err = new Error('This model requires more credits than available');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'credits' });
  });

  it('maps "requires at least" to UPSTREAM_REFUSED with credits reason', () => {
    const err = new Error('This request requires at least $0.50 in credits');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'credits' });
  });

  it('maps status 402 to UPSTREAM_REFUSED with credits suggestions', () => {
    const err = Object.assign(new Error('Payment required'), { status: 402 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /credit/i.test(s))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — context-length variants via "exceeds the model"
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — context-length "exceeds the model" variant', () => {
  it('maps "exceeds the model" to INVALID_INPUT with context_length reason', () => {
    const err = new Error('Token count exceeds the model limit');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('maps "context length exceeded" to INVALID_INPUT with context_length', () => {
    const err = new Error('context length exceeded for this conversation');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('maps "token limit" to INVALID_INPUT with context_length', () => {
    const err = new Error('You have exceeded the token limit for this model');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — ENETUNREACH / EHOSTUNREACH via code property
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — unreachable hosts via code property', () => {
  it('classifies ENETUNREACH via code property', () => {
    const err = Object.assign(new Error('Network unreachable'), { code: 'ENETUNREACH' });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'network' });
  });

  it('classifies EHOSTUNREACH via code property', () => {
    const err = Object.assign(new Error('Host unreachable'), { code: 'EHOSTUNREACH' });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'network' });
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — 4xx generic handler
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — generic 4xx', () => {
  it('maps unrecognized 400 to INVALID_INPUT with parameter suggestion', () => {
    const err = Object.assign(new Error('Some unknown client error'), { status: 400 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.suggestions!.some((s) => /OpenRouter docs/i.test(s))).toBe(true);
  });

  it('maps 422 to INVALID_INPUT', () => {
    const err = Object.assign(new Error('Unprocessable entity'), { status: 422 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('falls through to UPSTREAM_HTTP for unknown status-less errors', () => {
    const err = new Error('Something completely unexpected');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.suggestions!.some((s) => /status\.openrouter\.ai/i.test(s))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toolErrorFrom — edge cases
// ---------------------------------------------------------------------------
describe('toolErrorFrom — edge cases', () => {
  it('handles null input with "unknown error"', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, null);
    expect(r.content[0].text).toBe('unknown error');
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('handles undefined input with "unknown error"', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, undefined);
    expect(r.content[0].text).toBe('unknown error');
  });

  it('handles number input with "unknown error"', () => {
    const r = toolErrorFrom(ErrorCode.UPSTREAM_HTTP, 42);
    expect(r.content[0].text).toBe('unknown error');
  });

  it('handles string input with prefix', () => {
    const r = toolErrorFrom(ErrorCode.INVALID_INPUT, 'bad value', 'validation');
    expect(r.content[0].text).toBe('validation: bad value');
  });

  it('handles Error input with prefix and sanitization', () => {
    const err = new Error('Failed with Bearer sk-or-v1-secret123');
    const r = toolErrorFrom(ErrorCode.UPSTREAM_HTTP, err, 'fetch');
    expect(r.content[0].text).toContain('fetch:');
    expect(r.content[0].text).not.toContain('sk-or-v1-secret123');
  });
});

// ---------------------------------------------------------------------------
// handleEmbedText — additional edge cases
// ---------------------------------------------------------------------------
describe('handleEmbedText — additional edge cases', () => {
  it('returns success for a single text (not array)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello world' }), client)) as SuccessResult;
    expect(r.content[0].text).toContain('1 embedding(s)');
    expect(r.structuredContent.embeddings).toHaveLength(1);
  });

  it('handles response with usage including prompt_tokens and total_tokens', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'test/model',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hi' }), client)) as SuccessResult;
    expect(r._meta.usage).toEqual({ prompt_tokens: 5, total_tokens: 5 });
  });

  it('returns INVALID_INPUT for boolean in texts array', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [true] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });

  it('returns INVALID_INPUT for null in texts array', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: ['valid', null] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
  });

  it('returns INVALID_INPUT for object in texts array', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [{ nested: 'obj' }] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('classifies generic upstream error with full message', async () => {
    const err = new Error('Connection reset mid-stream');
    const client = {
      createEmbeddings: vi.fn().mockRejectedValue(err),
    } as unknown as OpenRouterAPIClient;
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
  });

  it('handles model with leading/trailing whitespace', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'cohere/embed-v4',
    });
    await handleEmbedText(embedReq({ texts: 'test', model: '  cohere/embed-v4  ' }), client);
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'cohere/embed-v4' }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleDecide — additional edge cases
// ---------------------------------------------------------------------------
describe('handleDecide — additional edge cases', () => {
  it('accepts undefined state without validation error', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'Is it raining?',
            criteria: { yes: 'Raining', no: 'Not raining' },
          },
        },
        // state deliberately omitted
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('passes state=undefined correctly to API (no state property)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    await handleDecide(
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
    );
    expect(client.submitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ state: undefined }),
    );
  });

  it('handles empty state object (valid)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
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
        state: {},
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('rejects state when it is a boolean', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
        state: true,
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('plain object');
  });

  it('formats mixed question types in multi-line summary correctly', async () => {
    const client = mockDecideClient({
      answers: {
        binary: { type: 'noul', noul: 0.95 },
        color: { type: 'choice', choice: { red: 0.1, blue: 0.8, green: 0.1 } },
        quality: { type: 'score', score: [0.05, 0.05, 0.1, 0.8] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          binary: {
            type: 'noul',
            instructions: 'yes/no',
            criteria: { yes: 'y', no: 'n' },
          },
          color: {
            type: 'choice',
            instructions: 'pick color',
            criteria: { red: 'R', blue: 'B', green: 'G' },
          },
          quality: {
            type: 'score',
            instructions: 'rate quality',
            criteria: ['terrible', 'bad', 'ok', 'great'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    const text = r.content[0].text;
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('binary');
    expect(lines[0]).toContain('YES');
    expect(lines[0]).toContain('95.0%');
    expect(lines[1]).toContain('color');
    expect(lines[1]).toContain('blue');
    expect(lines[1]).toContain('80.0%');
    expect(lines[2]).toContain('quality');
    expect(lines[2]).toContain('level 4/4');
    expect(lines[2]).toContain('80.0%');
  });

  it('returns INTERNAL when answers field is null', async () => {
    const client = mockDecideClient({ answers: null });
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
  });

  it('rejects score criteria that is an empty array', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: [] },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('2+ levels');
  });

  it('rejects non-string model (number)', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
        model: 42,
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects non-string model (boolean)', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
        model: true,
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('passes custom model to API after trimming', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
        model: '  microsoft/decision-1  ',
      }),
      client,
    );
    expect(client.submitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'microsoft/decision-1' }),
    );
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — HTML error page detection
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — HTML error pages', () => {
  it('detects <!DOCTYPE html> as HTML error page', () => {
    const err = new Error('<!DOCTYPE html><html><body>502 Bad Gateway</body></html>');
    const r = classifyUpstreamError(err, 'chat_completion');
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('HTML error page');
    expect(r.content[0].text).toContain('chat_completion');
  });

  it('detects <html> as HTML error page (no doctype)', () => {
    const err = new Error('<html><head>Error</head></html>');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('HTML error page');
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — "rate limit" text without 429 status
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — rate limit text without 429 status', () => {
  it('maps "rate limit" message to UPSTREAM_REFUSED even without 429 status', () => {
    const err = new Error('rate limit exceeded, please slow down');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'rate_limit' });
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — timeout heuristic edge cases
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — timeout heuristics', () => {
  it('maps "timed out" message to UPSTREAM_TIMEOUT', () => {
    const err = new Error('Request timed out after 30s');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('maps "timeout" message to UPSTREAM_TIMEOUT', () => {
    const err = new Error('Connection timeout while waiting for response');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('maps AbortError by name to UPSTREAM_TIMEOUT', () => {
    const err = Object.assign(new Error('Signal was aborted'), { name: 'AbortError' });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });
});
