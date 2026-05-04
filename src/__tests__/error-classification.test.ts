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
    const err: Error & { status?: number } = Object.assign(
      new Error('Insufficient credits'),
      { status: 402 },
    );
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
    expect(r._meta.suggestions!.some((s) => /30/.test(s) || /backoff/i.test(s))).toBe(
      true,
    );
  });

  it('falls back gracefully when Retry-After is not numeric', () => {
    const err = {
      status: 429,
      message: 'rate limit',
      headers: new Headers({ 'retry-after': 'Mon, 01 Jan 2030 00:00:00 GMT' }),
    };
    const r = classifyUpstreamError(err);
    // HTTP-date retry-after: we don't try to compute a delta, so field is omitted
    expect(r._meta.retry_after_seconds).toBeUndefined();
    // Suggestions still present
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
    expect(r._meta.suggestions!.some((s) => /search_models|validate_model/.test(s))).toBe(
      true,
    );
  });

  it('context label applies to rate-limit errors too', () => {
    const err = { status: 429, message: 'slow down', headers: { 'retry-after': '5' } };
    const r = classifyUpstreamError(err, 'generate_video.submit');
    expect(r.content[0].text.startsWith('generate_video.submit:')).toBe(true);
  });
});
