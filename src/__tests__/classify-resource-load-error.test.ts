import { describe, it, expect } from 'vitest';
import { classifyResourceLoadError } from '../tool-handlers/openrouter-errors.js';
import { UnsafePathError } from '../tool-handlers/path-safety.js';
import { ErrorCode } from '../errors.js';

describe('classifyResourceLoadError', () => {
  it('maps UnsafePathError to UNSAFE_PATH', () => {
    const err = new UnsafePathError('/etc/passwd');
    const r = classifyResourceLoadError(err, 'Image');
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.UNSAFE_PATH);
    expect(r.content[0].text).toContain('Image');
  });

  it('maps Blocked host to UPSTREAM_REFUSED', () => {
    const err = new Error('Blocked host: 127.0.0.1 (loopback)');
    const r = classifyResourceLoadError(err, 'Audio');
    expect(r._meta.code).toBe(ErrorCode.UPSTREAM_REFUSED);
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /loopback/i.test(s))).toBe(true);
  });

  it('maps too large to RESOURCE_TOO_LARGE', () => {
    const err = new Error('File too large (50MB, max 10MB)');
    const r = classifyResourceLoadError(err, 'Video');
    expect(r._meta.code).toBe(ErrorCode.RESOURCE_TOO_LARGE);
  });

  it('maps timed out to UPSTREAM_TIMEOUT', () => {
    const err = new Error('Request timed out after 30000ms');
    const r = classifyResourceLoadError(err, 'Frame image');
    expect(r._meta.code).toBe(ErrorCode.UPSTREAM_TIMEOUT);
  });

  it('maps timeout to UPSTREAM_TIMEOUT', () => {
    const err = new Error('Connection timeout');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe(ErrorCode.UPSTREAM_TIMEOUT);
  });

  it('maps unsupported to UNSUPPORTED_FORMAT', () => {
    const err = new Error('Unsupported image format: BMP');
    const r = classifyResourceLoadError(err, 'Reference image');
    expect(r._meta.code).toBe(ErrorCode.UNSUPPORTED_FORMAT);
  });

  it('maps not a video to UNSUPPORTED_FORMAT', () => {
    const err = new Error('Source is not a video file');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe(ErrorCode.UNSUPPORTED_FORMAT);
  });

  it('maps invalid data url to UNSUPPORTED_FORMAT', () => {
    const err = new Error('Invalid data URL: missing base64 segment');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe(ErrorCode.UNSUPPORTED_FORMAT);
  });

  it('maps generic errors to INVALID_INPUT as fallback', () => {
    const err = new Error('File not found: image.png');
    const r = classifyResourceLoadError(err, 'Image');
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('handles non-Error values', () => {
    const r = classifyResourceLoadError('something went wrong', 'Audio');
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('Audio');
  });

  it('works without a prefix', () => {
    const err = new Error('File too large');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe(ErrorCode.RESOURCE_TOO_LARGE);
    expect(r.content[0].text.startsWith(':')).toBe(false);
  });
});
