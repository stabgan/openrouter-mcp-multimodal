/**
 * Agent 2 — Coverage for exported functions with zero dedicated test coverage.
 *
 * Identified by cross-referencing `export function` declarations in source
 * against `grep -rl` over src/__tests__/. Only modifies test files.
 *
 * Targets:
 *
 * model-cache.ts:
 *  1. stripRoutingSuffix — strips :nitro, :floor, :free, :online, :exacto
 *  2. stripRoutingSuffix — case-insensitive (:FREE, :Nitro)
 *  3. stripRoutingSuffix — no suffix → returns original
 *  4. stripRoutingSuffix — empty string
 *  5. clampOffset — NaN, Infinity, negative, fractional, valid
 *  6. clampLimit — NaN, Infinity, zero, > MAX_SEARCH_LIMIT (50), fractional, fallback
 *
 * image-utils.ts:
 *  7. extensionForImageMime — svg, webp, jpeg, jpg, gif, bmp, png, unknown
 *
 * audio-utils.ts:
 *  8. sttFormatFromExtension — all supported extensions including dot prefix
 *  9. sttFormatFromExtension — unsupported extension throws
 *
 * chat-request.ts:
 * 10. validateSubagent — undefined, boolean true/false, valid object,
 *     invalid types (array, null, string, number), model validation
 */
import { describe, it, expect } from 'vitest';
import { stripRoutingSuffix, clampOffset, clampLimit, MAX_SEARCH_LIMIT } from '../model-cache.js';
import { extensionForImageMime } from '../tool-handlers/image-utils.js';
import { sttFormatFromExtension } from '../tool-handlers/audio-utils.js';
import { validateSubagent } from '../tool-handlers/chat-request.js';

// ---------------------------------------------------------------------------
// 1–4. stripRoutingSuffix
// ---------------------------------------------------------------------------

describe('stripRoutingSuffix', () => {
  it.each([
    ['openai/gpt-4o:nitro', 'openai/gpt-4o'],
    ['openai/gpt-4o:floor', 'openai/gpt-4o'],
    ['openai/gpt-4o:free', 'openai/gpt-4o'],
    ['openai/gpt-4o:online', 'openai/gpt-4o'],
    ['openai/gpt-4o:exacto', 'openai/gpt-4o'],
  ])('strips %s → %s', (input, expected) => {
    expect(stripRoutingSuffix(input)).toBe(expected);
  });

  it('is case-insensitive for suffix matching', () => {
    expect(stripRoutingSuffix('openai/gpt-4o:FREE')).toBe('openai/gpt-4o');
    expect(stripRoutingSuffix('openai/gpt-4o:Nitro')).toBe('openai/gpt-4o');
    expect(stripRoutingSuffix('openai/gpt-4o:FLOOR')).toBe('openai/gpt-4o');
    expect(stripRoutingSuffix('openai/gpt-4o:Online')).toBe('openai/gpt-4o');
    expect(stripRoutingSuffix('openai/gpt-4o:EXACTO')).toBe('openai/gpt-4o');
  });

  it('returns the original string when no suffix matches', () => {
    expect(stripRoutingSuffix('openai/gpt-4o')).toBe('openai/gpt-4o');
    expect(stripRoutingSuffix('anthropic/claude-3.5-sonnet')).toBe('anthropic/claude-3.5-sonnet');
    expect(stripRoutingSuffix('openai/gpt-4o:turbo')).toBe('openai/gpt-4o:turbo');
  });

  it('handles empty string', () => {
    expect(stripRoutingSuffix('')).toBe('');
  });

  it('does not strip suffix that appears mid-string', () => {
    expect(stripRoutingSuffix('nitro:model/name')).toBe('nitro:model/name');
  });

  it('strips only the last matching suffix', () => {
    // :free:nitro → lowercase ends with :nitro
    expect(stripRoutingSuffix('model:free:nitro')).toBe('model:free');
  });
});

// ---------------------------------------------------------------------------
// 5. clampOffset
// ---------------------------------------------------------------------------

describe('clampOffset', () => {
  it('returns 0 for NaN', () => {
    expect(clampOffset(NaN)).toBe(0);
  });

  it('returns 0 for Infinity', () => {
    expect(clampOffset(Infinity)).toBe(0);
  });

  it('returns 0 for -Infinity', () => {
    expect(clampOffset(-Infinity)).toBe(0);
  });

  it('returns 0 for negative values', () => {
    expect(clampOffset(-5)).toBe(0);
    expect(clampOffset(-1)).toBe(0);
  });

  it('floors fractional values', () => {
    expect(clampOffset(2.7)).toBe(2);
    expect(clampOffset(0.9)).toBe(0);
  });

  it('returns valid non-negative integers as-is', () => {
    expect(clampOffset(0)).toBe(0);
    expect(clampOffset(10)).toBe(10);
    expect(clampOffset(1000)).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 6. clampLimit
// ---------------------------------------------------------------------------

describe('clampLimit', () => {
  it('returns fallback (default 10) for NaN', () => {
    expect(clampLimit(NaN)).toBe(10);
  });

  it('returns fallback for Infinity', () => {
    expect(clampLimit(Infinity)).toBe(10);
  });

  it('returns fallback for -Infinity', () => {
    expect(clampLimit(-Infinity)).toBe(10);
  });

  it('uses custom fallback when provided', () => {
    expect(clampLimit(NaN, 20)).toBe(20);
    expect(clampLimit(Infinity, 5)).toBe(5);
  });

  it('clamps 0 to minimum 1', () => {
    expect(clampLimit(0)).toBe(1);
  });

  it('clamps negative to minimum 1', () => {
    expect(clampLimit(-10)).toBe(1);
  });

  it(`clamps values above MAX_SEARCH_LIMIT (${MAX_SEARCH_LIMIT}) down`, () => {
    expect(clampLimit(100)).toBe(MAX_SEARCH_LIMIT);
    expect(clampLimit(MAX_SEARCH_LIMIT + 1)).toBe(MAX_SEARCH_LIMIT);
  });

  it('accepts values within range', () => {
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(25)).toBe(25);
    expect(clampLimit(MAX_SEARCH_LIMIT)).toBe(MAX_SEARCH_LIMIT);
  });

  it('floors fractional values', () => {
    expect(clampLimit(2.9)).toBe(2);
    expect(clampLimit(49.99)).toBe(49);
  });
});

// ---------------------------------------------------------------------------
// 7. extensionForImageMime
// ---------------------------------------------------------------------------

describe('extensionForImageMime', () => {
  it.each([
    ['image/svg+xml', 'svg'],
    ['image/webp', 'webp'],
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
    ['image/gif', 'gif'],
    ['image/bmp', 'bmp'],
    ['image/png', 'png'],
  ])('returns %s → %s', (mime, expected) => {
    expect(extensionForImageMime(mime)).toBe(expected);
  });

  it('defaults to png for unknown image types', () => {
    expect(extensionForImageMime('image/tiff')).toBe('png');
    expect(extensionForImageMime('image/x-icon')).toBe('png');
    expect(extensionForImageMime('')).toBe('png');
  });

  it('handles partial mime strings containing format keywords', () => {
    expect(extensionForImageMime('foo/svg-stuff')).toBe('svg');
    expect(extensionForImageMime('something/with-webp')).toBe('webp');
    expect(extensionForImageMime('any/jpeg-variant')).toBe('jpg');
  });
});

// ---------------------------------------------------------------------------
// 8–9. sttFormatFromExtension
// ---------------------------------------------------------------------------

describe('sttFormatFromExtension', () => {
  it.each([
    ['mp3', 'mp3'],
    ['mp4', 'mp4'],
    ['m4a', 'mp4'],
    ['wav', 'wav'],
    ['flac', 'flac'],
    ['ogg', 'ogg'],
    ['oga', 'ogg'],
    ['webm', 'webm'],
    ['opus', 'opus'],
  ])('maps extension %s → format %s', (ext, expected) => {
    expect(sttFormatFromExtension(ext)).toBe(expected);
  });

  it('strips leading dot from extension', () => {
    expect(sttFormatFromExtension('.mp3')).toBe('mp3');
    expect(sttFormatFromExtension('.wav')).toBe('wav');
    expect(sttFormatFromExtension('.flac')).toBe('flac');
  });

  it('is case-insensitive', () => {
    expect(sttFormatFromExtension('MP3')).toBe('mp3');
    expect(sttFormatFromExtension('WAV')).toBe('wav');
    expect(sttFormatFromExtension('.FLAC')).toBe('flac');
    expect(sttFormatFromExtension('OGG')).toBe('ogg');
  });

  it('throws for unsupported extensions', () => {
    expect(() => sttFormatFromExtension('aac')).toThrow('Unsupported audio format');
    expect(() => sttFormatFromExtension('txt')).toThrow('Unsupported audio format');
    expect(() => sttFormatFromExtension('')).toThrow('Unsupported audio format');
    expect(() => sttFormatFromExtension('wma')).toThrow('Unsupported audio format');
  });
});

// ---------------------------------------------------------------------------
// 10. validateSubagent
// ---------------------------------------------------------------------------

describe('validateSubagent', () => {
  it('returns null for undefined (no subagent)', () => {
    expect(validateSubagent(undefined)).toBeNull();
  });

  it('returns null for boolean true', () => {
    expect(validateSubagent(true)).toBeNull();
  });

  it('returns null for boolean false', () => {
    expect(validateSubagent(false)).toBeNull();
  });

  it('returns null for valid object with model', () => {
    expect(validateSubagent({ model: 'openai/gpt-4o' })).toBeNull();
  });

  it('returns null for valid object without model', () => {
    expect(validateSubagent({})).toBeNull();
  });

  it('returns null for object with model=undefined', () => {
    expect(validateSubagent({ model: undefined })).toBeNull();
  });

  it('returns INVALID_INPUT for array', () => {
    const r = validateSubagent([] as unknown as boolean);
    expect(r).not.toBeNull();
    expect(r!._meta.code).toBe('INVALID_INPUT');
    expect(r!.content[0].text).toContain('boolean or an object');
  });

  it('returns INVALID_INPUT for null', () => {
    const r = validateSubagent(null as unknown as boolean);
    expect(r).not.toBeNull();
    expect(r!._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT for string', () => {
    const r = validateSubagent('openai/gpt-4o' as unknown as boolean);
    expect(r).not.toBeNull();
    expect(r!._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT for number', () => {
    const r = validateSubagent(42 as unknown as boolean);
    expect(r).not.toBeNull();
    expect(r!._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT for empty model string', () => {
    const r = validateSubagent({ model: '' });
    expect(r).not.toBeNull();
    expect(r!._meta.code).toBe('INVALID_INPUT');
    expect(r!.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT for whitespace-only model', () => {
    const r = validateSubagent({ model: '   ' });
    expect(r).not.toBeNull();
    expect(r!._meta.code).toBe('INVALID_INPUT');
    expect(r!.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT for non-string model', () => {
    const r = validateSubagent({ model: 42 as unknown as string });
    expect(r).not.toBeNull();
    expect(r!._meta.code).toBe('INVALID_INPUT');
    expect(r!.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT when model exceeds MAX_MODEL_ID_LENGTH (256)', () => {
    const r = validateSubagent({ model: 'm'.repeat(257) });
    expect(r).not.toBeNull();
    expect(r!._meta.code).toBe('INVALID_INPUT');
    expect(r!.content[0].text).toContain('256');
    expect(r!.content[0].text).toContain('257');
  });

  it('accepts model at exactly 256 characters', () => {
    expect(validateSubagent({ model: 'm'.repeat(256) })).toBeNull();
  });
});
