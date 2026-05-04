import { describe, it, expect } from 'vitest';
import { classifyUpstreamError } from '../tool-handlers/openrouter-errors.js';

describe('classifyUpstreamError', () => {
  it('maps credit errors to UPSTREAM_REFUSED', () => {
    const r = classifyUpstreamError({ status: 402, message: 'insufficient balance' });
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details?.reason).toBe('credits');
  });

  it('maps zero-data-retention errors', () => {
    const r = classifyUpstreamError(new Error('ZDR policy required'));
    expect(r._meta.code).toBe('ZDR_INCOMPATIBLE');
  });

  it('maps model not found errors', () => {
    const r = classifyUpstreamError(new Error('Model does not exist'));
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
  });

  it('maps content policy refusals', () => {
    const r = classifyUpstreamError(new Error('Content policy violation'));
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details?.reason).toBe('policy');
  });

  it('maps rate limit errors', () => {
    const r = classifyUpstreamError({ status: 429, message: 'Rate limit exceeded' });
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details?.reason).toBe('rate_limit');
  });

  it('maps timeout errors', () => {
    const err = Object.assign(new Error('Request timed out'), { name: 'AbortError' });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('maps generic 4xx to INVALID_INPUT', () => {
    const r = classifyUpstreamError({ status: 400, message: 'Bad request' });
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('maps 5xx responses to UPSTREAM_HTTP', () => {
    const r = classifyUpstreamError({ status: 503, message: 'Server exploded' });
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });

  it('defaults to UPSTREAM_HTTP for unknown errors', () => {
    const r = classifyUpstreamError('unknown');
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });
});
