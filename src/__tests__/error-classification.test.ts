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

  it('maps HTTP 408 to UPSTREAM_TIMEOUT', () => {
    const err = Object.assign(new Error('Request Timeout'), { status: 408 });
    const r = classifyUpstreamError(err, 'chat_completion');
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
    expect(r._meta.details).toEqual({ status: 408 });
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /retry/i.test(s))).toBe(true);
  });

  it('maps HTTP 413 to RESOURCE_TOO_LARGE', () => {
    const err = Object.assign(new Error('Payload Too Large'), { status: 413 });
    const r = classifyUpstreamError(err, 'generate_image');
    expect(r._meta.code).toBe('RESOURCE_TOO_LARGE');
    expect(r._meta.details).toEqual({ status: 413 });
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /size/i.test(s))).toBe(true);
  });

  it('maps "payload too large" text to RESOURCE_TOO_LARGE even without 413 status', () => {
    const err = new Error('Request payload too large for upstream');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('RESOURCE_TOO_LARGE');
  });

  it('maps "body too large" text to RESOURCE_TOO_LARGE', () => {
    const err = new Error('Request body too large');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('RESOURCE_TOO_LARGE');
  });
});

describe('classifyUpstreamError — context-length errors', () => {
  it('maps "context_length_exceeded" to INVALID_INPUT with context_length reason', () => {
    const err = Object.assign(new Error('context_length_exceeded'), { status: 400 });
    const r = classifyUpstreamError(err, 'chat_completion');
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: 400, reason: 'context_length' });
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /context/i.test(s))).toBe(true);
  });

  it('maps "maximum context length" to INVALID_INPUT with context_length reason', () => {
    const err = new Error(
      'This model maximum context length is 128000 tokens. Your messages resulted in 200000 tokens.',
    );
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
    expect(r._meta.suggestions!.some((s) => /reduce/i.test(s))).toBe(true);
  });

  it('maps "too many tokens" to INVALID_INPUT with context_length reason', () => {
    const err = Object.assign(new Error('Too many tokens in the request'), { status: 400 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: 400, reason: 'context_length' });
  });

  it('maps "context window" to INVALID_INPUT with context_length reason', () => {
    const err = new Error('This request exceeds the context window for this model');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('maps "input is too long" to INVALID_INPUT with context_length reason', () => {
    const err = new Error('input is too long for the selected model');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('maps "prompt is too long" to INVALID_INPUT with context_length reason', () => {
    const err = new Error('prompt is too long');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'context_length' });
  });

  it('suggests using get_model_info to check context_length', () => {
    const err = new Error('context_length_exceeded');
    const r = classifyUpstreamError(err);
    expect(r._meta.suggestions!.some((s) => /get_model_info/i.test(s))).toBe(true);
  });

  it('preserves context label on context-length errors', () => {
    const err = new Error('maximum context length exceeded');
    const r = classifyUpstreamError(err, 'start_chat_completion');
    expect(r.content[0].text.startsWith('start_chat_completion:')).toBe(true);
  });
});

describe('classifyUpstreamError — network-level errors', () => {
  it('maps ECONNREFUSED to UPSTREAM_REFUSED with network suggestions', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
      code: 'ECONNREFUSED',
    });
    const r = classifyUpstreamError(err, 'chat_completion');
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'network' });
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /connectivity/i.test(s))).toBe(true);
    expect(r._meta.suggestions!.some((s) => /status\.openrouter\.ai/i.test(s))).toBe(true);
  });

  it('maps ENOTFOUND (DNS failure) to UPSTREAM_REFUSED with network suggestions', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND openrouter.ai'), {
      code: 'ENOTFOUND',
    });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'network' });
  });

  it('maps ENETUNREACH to UPSTREAM_REFUSED', () => {
    const err = new Error('connect ENETUNREACH ::1:443');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'network' });
  });

  it('maps EHOSTUNREACH to UPSTREAM_REFUSED', () => {
    const err = new Error('connect EHOSTUNREACH 10.0.0.1:443');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'network' });
  });

  it('maps ECONNRESET to UPSTREAM_HTTP with connection_reset reason', () => {
    const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const r = classifyUpstreamError(err, 'generate_video');
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'connection_reset' });
    expect(r._meta.suggestions!.some((s) => /retry/i.test(s))).toBe(true);
  });

  it('maps EPIPE to UPSTREAM_HTTP with connection_reset reason', () => {
    const err = new Error('write EPIPE');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'connection_reset' });
  });

  it('maps "socket hang up" to UPSTREAM_HTTP with connection_reset reason', () => {
    const err = new Error('socket hang up');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'connection_reset' });
  });

  it('context label is preserved on network errors', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:443');
    const r = classifyUpstreamError(err, 'rerank');
    expect(r.content[0].text.startsWith('rerank:')).toBe(true);
  });
});

describe('classifyUpstreamError — TLS/certificate errors', () => {
  it('maps DEPTH_ZERO_SELF_SIGNED_CERT to UPSTREAM_REFUSED with tls reason', () => {
    const err = new Error('DEPTH_ZERO_SELF_SIGNED_CERT');
    const r = classifyUpstreamError(err, 'chat_completion');
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /NODE_EXTRA_CA_CERTS/i.test(s))).toBe(true);
  });

  it('maps SELF_SIGNED_CERT_IN_CHAIN to UPSTREAM_REFUSED with tls reason', () => {
    const err = new Error(
      'self signed certificate in certificate chain (SELF_SIGNED_CERT_IN_CHAIN)',
    );
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });

  it('maps UNABLE_TO_VERIFY_LEAF_SIGNATURE to UPSTREAM_REFUSED with tls reason', () => {
    const err = new Error('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });

  it('maps CERT_HAS_EXPIRED to UPSTREAM_REFUSED with clock suggestion', () => {
    const err = new Error('CERT_HAS_EXPIRED');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.suggestions!.some((s) => /clock/i.test(s))).toBe(true);
  });

  it('maps "certificate has expired" message to UPSTREAM_REFUSED', () => {
    const err = new Error('certificate has expired');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });

  it('maps UNABLE_TO_GET_ISSUER_CERT_LOCALLY to UPSTREAM_REFUSED', () => {
    const err = new Error('unable_to_get_issuer_cert_locally');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });

  it('maps ERR_TLS_CERT_ALTNAME_INVALID to UPSTREAM_REFUSED', () => {
    const err = new Error(
      'Hostname/IP does not match certificate altnames: ERR_TLS_CERT_ALTNAME_INVALID',
    );
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });

  it('maps "unable to verify the first certificate" to UPSTREAM_REFUSED', () => {
    const err = new Error('unable to verify the first certificate');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: undefined, reason: 'tls' });
  });

  it('preserves context label on TLS errors', () => {
    const err = new Error('DEPTH_ZERO_SELF_SIGNED_CERT');
    const r = classifyUpstreamError(err, 'generate_video');
    expect(r.content[0].text.startsWith('generate_video:')).toBe(true);
  });
});
