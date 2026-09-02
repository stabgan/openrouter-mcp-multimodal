import { describe, it, expect } from 'vitest';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';

describe('ErrorCode', () => {
  it('exposes a stable, non-empty set of codes', () => {
    const keys = Object.keys(ErrorCode);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      expect(ErrorCode[key as keyof typeof ErrorCode]).toBe(key);
    }
  });

  it('includes INVALID_CREDENTIALS for auth failures', () => {
    expect(ErrorCode.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
  });
});

describe('toolError', () => {
  it('builds the MCP error shape', () => {
    const r = toolError(ErrorCode.INVALID_INPUT, 'oops');
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: 'text', text: 'oops' }]);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('propagates details when provided', () => {
    const r = toolError(ErrorCode.UNSAFE_PATH, 'nope', { path: '/etc' });
    expect(r._meta.details).toEqual({ path: '/etc' });
  });

  it('omits details key when undefined', () => {
    const r = toolError(ErrorCode.INTERNAL, 'x');
    expect('details' in r._meta).toBe(false);
  });
});

describe('toolErrorFrom', () => {
  it('extracts message from Error instances', () => {
    const r = toolErrorFrom(ErrorCode.UPSTREAM_HTTP, new Error('boom'));
    expect(r.content[0].text).toBe('boom');
  });

  it('wraps strings verbatim', () => {
    const r = toolErrorFrom(ErrorCode.UPSTREAM_HTTP, 'string error');
    expect(r.content[0].text).toBe('string error');
  });

  it('falls back to "unknown error" for opaque values', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, { what: 'this' });
    expect(r.content[0].text).toBe('unknown error');
  });

  it('honors the prefix', () => {
    const r = toolErrorFrom(ErrorCode.UPSTREAM_HTTP, new Error('boom'), 'fetching');
    expect(r.content[0].text).toBe('fetching: boom');
  });

  it('assigns to CallToolResult without casts', () => {
    const result: CallToolResult = toolError(ErrorCode.INVALID_INPUT, 'bad');
    expect(CallToolResultSchema.safeParse(result).success).toBe(true);
    expect(result._meta?.code).toBe('INVALID_INPUT');
  });

  it('preserves suggestions and retry_after_seconds in _meta', () => {
    const result = toolError(ErrorCode.UPSTREAM_HTTP, 'rate limited', undefined, {
      suggestions: ['Wait and retry'],
      retry_after_seconds: 30,
    });
    expect(result._meta.suggestions).toEqual(['Wait and retry']);
    expect(result._meta.retry_after_seconds).toBe(30);
    expect(CallToolResultSchema.safeParse(result).success).toBe(true);
  });
});
