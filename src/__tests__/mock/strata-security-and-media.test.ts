import { describe, it, expect } from 'vitest';
import { isBlockedIPv4 } from '../../tool-handlers/fetch-utils.js';
import { sniffImageMime, mimeFromExtension } from '../../tool-handlers/image-utils.js';
import { ErrorCode, toolError, toolErrorFrom } from '../../errors.js';
import { TOOL_NAMES, TOOL_DESCRIPTIONS } from '../../tool-descriptions.js';

describe('mock strata: IPv4 SSRF block matrix', () => {
  const blocked10 = Array.from({ length: 16 }, (_, i) => `10.${i}.1.1`);
  it.each(blocked10)('blocks RFC1918 10.%i.x address %s', (ip) => {
    expect(isBlockedIPv4(ip)).toBe(true);
  });

  const blocked172 = Array.from({ length: 16 }, (_, i) => `172.${16 + i}.0.1`);
  it.each(blocked172)('blocks RFC1918 172.%i.x address %s', (ip) => {
    expect(isBlockedIPv4(ip)).toBe(true);
  });

  const blocked192 = Array.from({ length: 16 }, (_, i) => `192.168.${i}.1`);
  it.each(blocked192)('blocks RFC1918 192.168.%i.x address %s', (ip) => {
    expect(isBlockedIPv4(ip)).toBe(true);
  });

  const blocked127 = Array.from({ length: 8 }, (_, i) => `127.0.0.${i + 1}`);
  it.each(blocked127)('blocks loopback %s', (ip) => {
    expect(isBlockedIPv4(ip)).toBe(true);
  });

  const publicIps = [
    '8.8.8.8',
    '8.8.4.4',
    '1.1.1.1',
    '1.0.0.1',
    '142.250.80.46',
    '34.102.136.180',
    '52.84.0.0',
    '93.184.216.34',
    '151.101.1.140',
    '199.232.38.133',
    '104.16.132.229',
    '185.199.108.153',
    '13.107.42.14',
    '20.190.128.1',
    '74.125.200.138',
    '216.58.214.174',
  ];
  it.each(publicIps)('allows public IP %s', (ip) => {
    expect(isBlockedIPv4(ip)).toBe(false);
  });
});

describe('mock strata: image MIME utilities matrix', () => {
  const extCases: Array<[string, string | null]> = [
    ['photo.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['photo.webp', 'image/webp'],
    ['photo.gif', 'image/gif'],
    ['photo.bmp', 'image/bmp'],
    ['photo.PNG', 'image/png'],
    ['photo', null],
    ['photo.xyz', null],
    ['', null],
  ];
  it.each(extCases)('mimeFromExtension(%s) → %s', (file, expected) => {
    expect(mimeFromExtension(file.split('.').pop() ?? '')).toBe(expected);
  });

  const sniffCases: Array<[number[], string | null]> = [
    [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
    [[0xff, 0xd8, 0xff, 0x00], 'image/jpeg'],
    [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
    [[0x42, 0x4d, 0x00, 0x00], 'image/bmp'],
    [[0x00, 0x00, 0x00, 0x00], null],
    [[0x01, 0x02, 0x03, 0x04], null],
  ];
  it.each(sniffCases)('sniffImageMime magic bytes %# → %s', (bytes, expected) => {
    expect(sniffImageMime(Buffer.from(bytes))).toBe(expected);
  });
});

describe('mock strata: error taxonomy matrix', () => {
  const codes = Object.values(ErrorCode);
  it.each(codes)('toolError(%s) sets _meta.code', (code) => {
    const r = toolError(code, 'test message');
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(code);
    expect(r.content[0].text).toBe('test message');
  });

  it.each(codes)('toolError(%s) preserves details object', (code) => {
    const r = toolError(code, 'msg', { field: 'x' });
    expect(r._meta.details).toEqual({ field: 'x' });
  });

  const fromCases: Array<[unknown, string]> = [
    [new Error('boom'), 'boom'],
    ['plain string', 'plain string'],
    [42, 'unknown error'],
    [null, 'unknown error'],
    [undefined, 'unknown error'],
  ];
  it.each(fromCases)('toolErrorFrom handles %s', (err, expectedFragment) => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, err, 'prefix');
    expect(r.content[0].text).toContain(expectedFragment);
  });
});

describe('mock strata: tool description keyword matrix', () => {
  const keywords = [
    'Use when:',
    'Do NOT use when:',
    'Good examples:',
    'Bad examples:',
    'Fails when:',
    'Works with:',
  ];
  const toolKeywordPairs = TOOL_NAMES.flatMap((tool) => keywords.map((kw) => [tool, kw] as const));
  it.each(toolKeywordPairs)('%s contains %s', (tool, kw) => {
    expect(TOOL_DESCRIPTIONS[tool]).toContain(kw);
  });

  const videoTools = ['generate_video', 'generate_video_from_image', 'get_video_status'] as const;
  it.each(videoTools)('%s documents JOB_STILL_RUNNING', (tool) => {
    expect(TOOL_DESCRIPTIONS[tool]).toContain('JOB_STILL_RUNNING');
  });

  const analyzeTools = ['analyze_image', 'analyze_audio', 'analyze_video'] as const;
  it.each(analyzeTools)('%s documents UNSAFE_PATH', (tool) => {
    expect(TOOL_DESCRIPTIONS[tool]).toContain('UNSAFE_PATH');
  });
});
