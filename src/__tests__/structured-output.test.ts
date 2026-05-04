import { describe, it, expect } from 'vitest';
import { buildStructuredResult } from '../tool-handlers/structured-output.js';
import { SERVER_VERSION } from '../version.js';

describe('buildStructuredResult', () => {
  it('emits content + structuredContent + _meta', () => {
    const result = buildStructuredResult({ hello: 'world' });
    expect(result.structuredContent).toEqual({ hello: 'world' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({ hello: 'world' });
  });

  it('stamps server_version in _meta', () => {
    const result = buildStructuredResult({ any: 'value' });
    expect(result._meta.server_version).toBe(SERVER_VERSION);
  });

  it('merges extra meta on top of the default stamp', () => {
    const result = buildStructuredResult({ x: 1 }, { custom: 'tag' });
    expect(result._meta).toEqual({
      server_version: SERVER_VERSION,
      custom: 'tag',
    });
  });

  it('lets caller override server_version if they really want to', () => {
    const result = buildStructuredResult({ x: 1 }, { server_version: 'override' });
    expect(result._meta.server_version).toBe('override');
  });

  it('handles arrays', () => {
    const result = buildStructuredResult([1, 2, 3]);
    expect(result.structuredContent).toEqual([1, 2, 3]);
    expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3]);
  });

  it('handles nested objects with pretty-printed JSON', () => {
    const data = { nested: { arr: [1, { k: 'v' }] } };
    const result = buildStructuredResult(data);
    expect(result.content[0].text).toContain('\n'); // 2-space indent
    expect(result.structuredContent).toEqual(data);
  });
});
