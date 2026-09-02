/**
 * v4.5.1 — confirm classifyUpstreamError now uses its contextMessage arg
 * and populates `suggestions` / `retry_after_seconds` from upstream
 * signals. This is the end-to-end contract that the CHANGELOG advertised.
 */
import { describe, it, expect } from 'vitest';
import { classifyUpstreamError } from '../tool-handlers/openrouter-errors.js';

describe('classifyUpstreamError — context + suggestions', () => {
  it('prefixes the returned message with the context label', () => {
    const r = classifyUpstreamError(new Error('HTTP 500'), 'rerank');
    expect(r.content[0].text).toBe('rerank: HTTP 500');
  });

  it('leaves the message intact when no context label is given', () => {
    const r = classifyUpstreamError(new Error('boom'));
    expect(r.content[0].text).toBe('boom');
  });

  it('attaches suggestions on a 402 credits error', () => {
    const err: Error & { status?: number } = Object.assign(new Error('Insufficient credits'), {
      status: 402,
    });
    const r = classifyUpstreamError(err);
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.length).toBeGreaterThan(0);
    expect(r._meta.suggestions!.some((s) => /credit/i.test(s))).toBe(true);
  });

  it('attaches suggestions + retry_after_seconds on a 429 with Retry-After header', () => {
    // SDK-style error shape: { status, headers: Headers-like }
    const err = {
      status: 429,
      message: 'rate limit',
      headers: new Headers({ 'retry-after': '30' }),
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBe(30);
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /30/.test(s) || /backoff/i.test(s))).toBe(true);
  });

  it('parses HTTP-date Retry-After when present', () => {
    const err = {
      status: 429,
      message: 'rate limit',
      headers: new Headers({ 'retry-after': 'Mon, 01 Jan 2030 00:00:00 GMT' }),
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBeGreaterThan(0);
    expect(r._meta.suggestions).toBeDefined();
  });

  it('attaches suggestions on content-policy refusals', () => {
    const r = classifyUpstreamError(new Error('flagged by content policy'));
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.suggestions).toBeDefined();
  });

  it('attaches suggestions on model-not-found errors', () => {
    const r = classifyUpstreamError(new Error('model does not exist: foo/bar'));
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /search_models|validate_model/.test(s))).toBe(true);
  });

  it('context label applies to rate-limit errors too', () => {
    const err = { status: 429, message: 'slow down', headers: { 'retry-after': '5' } };
    const r = classifyUpstreamError(err, 'generate_video.submit');
    expect(r.content[0].text.startsWith('generate_video.submit:')).toBe(true);
  });
});

describe('classifyUpstreamError — auth and status codes', () => {
  it('maps 401 to INVALID_CREDENTIALS with actionable suggestions', () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    const r = classifyUpstreamError(err, 'chat_completion');
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
    expect(r._meta.details).toEqual({ status: 401, reason: 'auth' });
    expect(r._meta.suggestions!.some((s) => /OPENROUTER_API_KEY/i.test(s))).toBe(true);
  });

  it('maps SDK authentication_error envelope to INVALID_CREDENTIALS', () => {
    const err = {
      status: 401,
      message: '401 status code',
      error: {
        type: 'authentication_error',
        message: 'Invalid credentials',
        error_type: 'authentication',
      },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps 403 guardrail blocks to UPSTREAM_REFUSED policy', () => {
    const err = Object.assign(new Error('Request blocked: prompt injection patterns detected'), {
      status: 403,
    });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: 403, reason: 'policy' });
  });

  it('maps HTTP 404 to MODEL_NOT_FOUND', () => {
    const err = Object.assign(new Error('Not found'), { status: 404 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
  });

  it('maps 5xx to UPSTREAM_HTTP with retry suggestions', () => {
    const err = Object.assign(new Error('Bad gateway'), { status: 502 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.suggestions!.some((s) => /status\.openrouter\.ai/i.test(s))).toBe(true);
  });

  it('maps timeout/AbortError to UPSTREAM_TIMEOUT', () => {
    const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('parses HTTP-date Retry-After on 429', () => {
    const future = new Date(Date.now() + 45_000).toUTCString();
    const err = {
      status: 429,
      message: 'rate limit',
      headers: new Headers({ 'retry-after': future }),
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBeGreaterThanOrEqual(40);
    expect(r._meta.retry_after_seconds).toBeLessThanOrEqual(50);
  });

  it('redacts bearer tokens from error messages', () => {
    const err = new Error('Request failed with Bearer sk-or-v1-deadbeef in header');
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).not.toContain('sk-or-v1-deadbeef');
    expect(r.content[0].text).toContain('[REDACTED]');
  });

  it('treats HTML error pages as UPSTREAM_HTTP', () => {
    const err = new Error('<html><body>502 Bad Gateway</body></html>');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('HTML error page');
  });
});
