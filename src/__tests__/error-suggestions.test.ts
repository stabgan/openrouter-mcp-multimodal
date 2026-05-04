import { describe, it, expect } from 'vitest';
import { toolError, toolErrorFrom, ErrorCode } from '../errors.js';

describe('toolError options', () => {
  it('emits suggestions when provided', () => {
    const r = toolError(ErrorCode.UPSTREAM_REFUSED, 'Rate limit', undefined, {
      suggestions: ['Wait and retry', 'Lower concurrency'],
    });
    expect(r._meta.suggestions).toEqual(['Wait and retry', 'Lower concurrency']);
  });

  it('emits retry_after_seconds when provided', () => {
    const r = toolError(ErrorCode.UPSTREAM_REFUSED, 'Rate limit', undefined, {
      retry_after_seconds: 30,
    });
    expect(r._meta.retry_after_seconds).toBe(30);
  });

  it('skips empty suggestions array', () => {
    const r = toolError(ErrorCode.UPSTREAM_REFUSED, 'x', undefined, { suggestions: [] });
    expect(r._meta.suggestions).toBeUndefined();
  });

  it('toolErrorFrom accepts opts', () => {
    const r = toolErrorFrom(ErrorCode.INVALID_INPUT, new Error('bad'), undefined, {
      suggestions: ['Check your input format'],
    });
    expect(r._meta.suggestions).toEqual(['Check your input format']);
  });

  it('preserves the message text', () => {
    const r = toolError(ErrorCode.INVALID_INPUT, 'you did wrong', undefined, {
      suggestions: ['do better'],
    });
    expect(r.content[0].text).toBe('you did wrong');
  });

  it('returns a result with isError=true', () => {
    const r = toolError(ErrorCode.INTERNAL, 'x');
    expect(r.isError).toBe(true);
  });
});
