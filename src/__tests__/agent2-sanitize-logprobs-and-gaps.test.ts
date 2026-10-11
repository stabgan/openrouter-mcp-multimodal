/**
 * Coverage for untested code paths:
 *
 * 1. sanitizeLogprobs (completion-utils.ts) — ZERO prior test coverage
 *    - Valid logprobs with content and top_logprobs
 *    - Non-object input (null, undefined, array, string, number)
 *    - Prototype-pollution keys at every nesting level
 *    - Non-string token, non-finite logprob, bytes validation
 *    - Token truncation at MAX_LOGPROBS_TOKEN_LENGTH (512)
 *    - Content array capping at MAX_LOGPROBS_CONTENT_ENTRIES (10_000)
 *    - top_logprobs capping at MAX_TOP_LOGPROBS_PER_TOKEN (20)
 *    - Bytes array capping at MAX_LOGPROBS_BYTES_LENGTH (64)
 *    - Refusal logprobs
 *    - Both null → returns undefined
 *    - Mixed valid/invalid entries
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests in src/__tests__/ — it does NOT modify source code.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeLogprobs } from '../tool-handlers/completion-utils.js';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function validEntry(token = 'hello', logprob = -0.5, bytes: number[] | null = [104, 101]) {
  return { token, logprob, bytes };
}

function validContentEntry(
  token = 'hello',
  logprob = -0.5,
  bytes: number[] | null = [104, 101],
  topLogprobs: unknown[] = [],
) {
  return { token, logprob, bytes, top_logprobs: topLogprobs };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. sanitizeLogprobs — non-object input returns undefined
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — non-object input', () => {
  it('returns undefined for null', () => {
    expect(sanitizeLogprobs(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(sanitizeLogprobs(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(sanitizeLogprobs('')).toBeUndefined();
  });

  it('returns undefined for number', () => {
    expect(sanitizeLogprobs(42)).toBeUndefined();
  });

  it('returns undefined for boolean', () => {
    expect(sanitizeLogprobs(true)).toBeUndefined();
  });

  it('returns undefined for array', () => {
    expect(sanitizeLogprobs([{ token: 'hi', logprob: -1, bytes: null }])).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. sanitizeLogprobs — prototype-pollution keys at top level
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — prototype-pollution at top level', () => {
  it('returns undefined when top-level has __proto__ key', () => {
    const raw = Object.create(null);
    raw['__proto__'] = 'polluted';
    raw.content = [validContentEntry()];
    expect(sanitizeLogprobs(raw)).toBeUndefined();
  });

  it('returns undefined when top-level has constructor key', () => {
    const raw = Object.create(null);
    raw['constructor'] = {};
    raw.content = [validContentEntry()];
    expect(sanitizeLogprobs(raw)).toBeUndefined();
  });

  it('returns undefined when top-level has prototype key', () => {
    const raw = Object.create(null);
    raw['prototype'] = {};
    raw.content = [validContentEntry()];
    expect(sanitizeLogprobs(raw)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. sanitizeLogprobs — valid content logprobs
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — valid content', () => {
  it('sanitizes a simple valid content entry', () => {
    const result = sanitizeLogprobs({
      content: [validContentEntry('world', -1.2, [119, 111])],
    });
    expect(result).toBeDefined();
    expect(result!.content).toHaveLength(1);
    expect(result!.content![0].token).toBe('world');
    expect(result!.content![0].logprob).toBe(-1.2);
    expect(result!.content![0].bytes).toEqual([119, 111]);
    expect(result!.content![0].top_logprobs).toEqual([]);
  });

  it('sanitizes multiple content entries', () => {
    const result = sanitizeLogprobs({
      content: [validContentEntry('a', -0.1, null), validContentEntry('b', -0.2, [98])],
    });
    expect(result!.content).toHaveLength(2);
    expect(result!.content![0].token).toBe('a');
    expect(result!.content![0].bytes).toBeNull();
    expect(result!.content![1].token).toBe('b');
  });

  it('includes top_logprobs from valid entries', () => {
    const result = sanitizeLogprobs({
      content: [
        validContentEntry('hi', -0.5, null, [
          validEntry('hi', -0.5, null),
          validEntry('hey', -1.2, [104]),
        ]),
      ],
    });
    expect(result!.content![0].top_logprobs).toHaveLength(2);
    expect(result!.content![0].top_logprobs[0].token).toBe('hi');
    expect(result!.content![0].top_logprobs[1].token).toBe('hey');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. sanitizeLogprobs — content entry validation
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — content entry validation', () => {
  it('skips null entries in content array', () => {
    const result = sanitizeLogprobs({
      content: [null, validContentEntry()],
    });
    expect(result!.content).toHaveLength(1);
    expect(result!.content![0].token).toBe('hello');
  });

  it('skips string entries in content array', () => {
    const result = sanitizeLogprobs({
      content: ['not an object', validContentEntry('ok', -0.1, null)],
    });
    expect(result!.content).toHaveLength(1);
  });

  it('skips array entries in content array', () => {
    const result = sanitizeLogprobs({
      content: [[1, 2, 3], validContentEntry('ok', -0.1, null)],
    });
    expect(result!.content).toHaveLength(1);
  });

  it('skips entries with prototype-pollution keys', () => {
    const bad = Object.create(null);
    bad.token = 'hi';
    bad.logprob = -0.5;
    bad.bytes = null;
    bad['__proto__'] = 'polluted';
    bad.top_logprobs = [];
    const result = sanitizeLogprobs({
      content: [bad, validContentEntry('ok', -0.3, null)],
    });
    expect(result!.content).toHaveLength(1);
    expect(result!.content![0].token).toBe('ok');
  });

  it('skips entries with non-string token', () => {
    const result = sanitizeLogprobs({
      content: [
        { token: 42, logprob: -0.5, bytes: null, top_logprobs: [] },
        validContentEntry('valid', -0.1, null),
      ],
    });
    expect(result!.content).toHaveLength(1);
    expect(result!.content![0].token).toBe('valid');
  });

  it('skips entries with non-finite logprob (NaN)', () => {
    const result = sanitizeLogprobs({
      content: [
        { token: 'bad', logprob: NaN, bytes: null, top_logprobs: [] },
        validContentEntry('good', -0.2, null),
      ],
    });
    expect(result!.content).toHaveLength(1);
    expect(result!.content![0].token).toBe('good');
  });

  it('skips entries with Infinity logprob', () => {
    const result = sanitizeLogprobs({
      content: [
        { token: 'bad', logprob: Infinity, bytes: null, top_logprobs: [] },
        validContentEntry('ok', -0.1, null),
      ],
    });
    expect(result!.content).toHaveLength(1);
  });

  it('skips entries with -Infinity logprob', () => {
    const result = sanitizeLogprobs({
      content: [
        { token: 'bad', logprob: -Infinity, bytes: null, top_logprobs: [] },
        validContentEntry('ok', -0.1, null),
      ],
    });
    expect(result!.content).toHaveLength(1);
  });

  it('skips entries with non-number logprob (string)', () => {
    const result = sanitizeLogprobs({
      content: [
        { token: 'bad', logprob: 'high', bytes: null, top_logprobs: [] },
        validContentEntry('ok', -0.1, null),
      ],
    });
    expect(result!.content).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. sanitizeLogprobs — token truncation (MAX_LOGPROBS_TOKEN_LENGTH = 512)
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — token truncation', () => {
  it('truncates token exceeding 512 characters', () => {
    const longToken = 'x'.repeat(600);
    const result = sanitizeLogprobs({
      content: [{ token: longToken, logprob: -0.1, bytes: null, top_logprobs: [] }],
    });
    expect(result!.content![0].token).toHaveLength(512);
    expect(result!.content![0].token).toBe('x'.repeat(512));
  });

  it('preserves token at exactly 512 characters', () => {
    const exactToken = 'y'.repeat(512);
    const result = sanitizeLogprobs({
      content: [{ token: exactToken, logprob: -0.1, bytes: null, top_logprobs: [] }],
    });
    expect(result!.content![0].token).toHaveLength(512);
  });

  it('preserves short token as-is', () => {
    const result = sanitizeLogprobs({
      content: [validContentEntry('hi', -0.3, null)],
    });
    expect(result!.content![0].token).toBe('hi');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. sanitizeLogprobs — bytes validation
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — bytes validation', () => {
  it('passes null bytes through as null', () => {
    const result = sanitizeLogprobs({
      content: [validContentEntry('a', -0.1, null)],
    });
    expect(result!.content![0].bytes).toBeNull();
  });

  it('passes undefined bytes through as null', () => {
    const result = sanitizeLogprobs({
      content: [{ token: 'a', logprob: -0.1, bytes: undefined, top_logprobs: [] }],
    });
    expect(result!.content![0].bytes).toBeNull();
  });

  it('rejects entry when bytes is a non-array value', () => {
    const result = sanitizeLogprobs({
      content: [
        { token: 'bad', logprob: -0.1, bytes: 'not-array', top_logprobs: [] },
        validContentEntry('ok', -0.2, null),
      ],
    });
    // Non-array bytes causes sanitizeLogprobEntry to return null → entry skipped
    expect(result!.content).toHaveLength(1);
    expect(result!.content![0].token).toBe('ok');
  });

  it('filters out non-integer byte values', () => {
    const result = sanitizeLogprobs({
      content: [{ token: 'a', logprob: -0.1, bytes: [72, 'bad', 101, NaN, 108], top_logprobs: [] }],
    });
    // Only valid integers 0-255 are kept
    expect(result!.content![0].bytes).toEqual([72, 101, 108]);
  });

  it('filters out byte values outside 0-255 range', () => {
    const result = sanitizeLogprobs({
      content: [{ token: 'a', logprob: -0.1, bytes: [-1, 0, 255, 256, 72], top_logprobs: [] }],
    });
    expect(result!.content![0].bytes).toEqual([0, 255, 72]);
  });

  it('filters out non-integer byte values (floats)', () => {
    const result = sanitizeLogprobs({
      content: [{ token: 'a', logprob: -0.1, bytes: [72, 1.5, 101], top_logprobs: [] }],
    });
    expect(result!.content![0].bytes).toEqual([72, 101]);
  });

  it('caps bytes array at 64 elements', () => {
    const longBytes = Array.from({ length: 100 }, (_, i) => i % 256);
    const result = sanitizeLogprobs({
      content: [{ token: 'a', logprob: -0.1, bytes: longBytes, top_logprobs: [] }],
    });
    // Only first 64 are considered
    expect(result!.content![0].bytes!.length).toBeLessThanOrEqual(64);
  });

  it('preserves bytes at exactly 64 elements', () => {
    const exactBytes = Array.from({ length: 64 }, (_, i) => i % 256);
    const result = sanitizeLogprobs({
      content: [{ token: 'a', logprob: -0.1, bytes: exactBytes, top_logprobs: [] }],
    });
    expect(result!.content![0].bytes).toHaveLength(64);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. sanitizeLogprobs — content capping at 10_000 entries
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — content array capping', () => {
  it('caps content at 10_000 entries', () => {
    const entries = Array.from({ length: 10_005 }, (_, i) =>
      validContentEntry(`t${i}`, -0.1 * (i + 1), null),
    );
    const result = sanitizeLogprobs({ content: entries });
    expect(result!.content!.length).toBeLessThanOrEqual(10_000);
  });

  it('preserves content at exactly 10_000 entries', () => {
    const entries = Array.from({ length: 10_000 }, (_, i) =>
      validContentEntry(`t${i}`, -0.01, null),
    );
    const result = sanitizeLogprobs({ content: entries });
    expect(result!.content).toHaveLength(10_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. sanitizeLogprobs — top_logprobs capping at 20
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — top_logprobs capping', () => {
  it('caps top_logprobs at 20 entries', () => {
    const topEntries = Array.from({ length: 25 }, (_, i) =>
      validEntry(`top${i}`, -0.1 * (i + 1), null),
    );
    const result = sanitizeLogprobs({
      content: [validContentEntry('main', -0.5, null, topEntries)],
    });
    expect(result!.content![0].top_logprobs.length).toBeLessThanOrEqual(20);
  });

  it('preserves top_logprobs at exactly 20 entries', () => {
    const topEntries = Array.from({ length: 20 }, (_, i) => validEntry(`top${i}`, -0.05, null));
    const result = sanitizeLogprobs({
      content: [validContentEntry('main', -0.5, null, topEntries)],
    });
    expect(result!.content![0].top_logprobs).toHaveLength(20);
  });

  it('filters invalid entries from top_logprobs', () => {
    const topEntries = [
      validEntry('good', -0.3, null),
      { token: 42, logprob: -0.5, bytes: null }, // invalid: non-string token
      validEntry('also-good', -0.8, null),
      null, // invalid: null
    ];
    const result = sanitizeLogprobs({
      content: [validContentEntry('main', -0.5, null, topEntries)],
    });
    expect(result!.content![0].top_logprobs).toHaveLength(2);
    expect(result!.content![0].top_logprobs[0].token).toBe('good');
    expect(result!.content![0].top_logprobs[1].token).toBe('also-good');
  });

  it('handles non-array top_logprobs gracefully', () => {
    const result = sanitizeLogprobs({
      content: [{ token: 'a', logprob: -0.1, bytes: null, top_logprobs: 'not-array' }],
    });
    expect(result!.content![0].top_logprobs).toEqual([]);
  });

  it('handles missing top_logprobs gracefully', () => {
    const result = sanitizeLogprobs({
      content: [{ token: 'a', logprob: -0.1, bytes: null }],
    });
    expect(result!.content![0].top_logprobs).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. sanitizeLogprobs — refusal logprobs
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — refusal logprobs', () => {
  it('sanitizes valid refusal logprobs', () => {
    const result = sanitizeLogprobs({
      refusal: [validContentEntry('I', -0.1, [73]), validContentEntry('cannot', -0.3, null)],
    });
    expect(result).toBeDefined();
    expect(result!.content).toBeNull();
    expect(result!.refusal).toHaveLength(2);
    expect(result!.refusal![0].token).toBe('I');
    expect(result!.refusal![1].token).toBe('cannot');
  });

  it('returns both content and refusal when both are valid', () => {
    const result = sanitizeLogprobs({
      content: [validContentEntry('hi', -0.5, null)],
      refusal: [validContentEntry('no', -0.3, null)],
    });
    expect(result!.content).toHaveLength(1);
    expect(result!.refusal).toHaveLength(1);
  });

  it('returns undefined when both content and refusal are null', () => {
    const result = sanitizeLogprobs({ content: null, refusal: null });
    expect(result).toBeUndefined();
  });

  it('returns undefined when both content and refusal are undefined', () => {
    const result = sanitizeLogprobs({});
    expect(result).toBeUndefined();
  });

  it('returns undefined when content is empty array and refusal is null', () => {
    const result = sanitizeLogprobs({ content: [], refusal: null });
    // sanitizeLogprobContentArray([]) returns empty result → null
    expect(result).toBeUndefined();
  });

  it('returns content when content is valid and refusal is empty', () => {
    const result = sanitizeLogprobs({
      content: [validContentEntry('ok', -0.1, null)],
      refusal: [],
    });
    expect(result).toBeDefined();
    expect(result!.content).toHaveLength(1);
    expect(result!.refusal).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. sanitizeLogprobs — non-array content/refusal
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — non-array content/refusal fields', () => {
  it('treats non-array content as null', () => {
    const result = sanitizeLogprobs({
      content: 'not an array',
      refusal: [validContentEntry('ok', -0.1, null)],
    });
    expect(result).toBeDefined();
    expect(result!.content).toBeNull();
    expect(result!.refusal).toHaveLength(1);
  });

  it('treats numeric content as null', () => {
    const result = sanitizeLogprobs({
      content: 42,
      refusal: [validContentEntry('ok', -0.1, null)],
    });
    expect(result!.content).toBeNull();
  });

  it('treats object content as null (not array)', () => {
    const result = sanitizeLogprobs({
      content: { token: 'hi' },
      refusal: [validContentEntry('ok', -0.1, null)],
    });
    expect(result!.content).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. sanitizeLogprobs — mixed valid and invalid in content
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — mixed valid and invalid content entries', () => {
  it('filters out all invalid entries, keeping only valid ones', () => {
    const result = sanitizeLogprobs({
      content: [
        null, // skipped: null
        { token: 42, logprob: -0.1, bytes: null, top_logprobs: [] }, // skipped: non-string token
        validContentEntry('good1', -0.2, null),
        { token: 'bad', logprob: NaN, bytes: null, top_logprobs: [] }, // skipped: NaN logprob
        { token: 'bad2', logprob: -0.1, bytes: 'invalid', top_logprobs: [] }, // skipped: non-array bytes
        validContentEntry('good2', -0.3, [103]),
        'string-entry', // skipped: not an object
        [1, 2], // skipped: array, not object
      ],
    });
    expect(result!.content).toHaveLength(2);
    expect(result!.content![0].token).toBe('good1');
    expect(result!.content![1].token).toBe('good2');
  });

  it('returns undefined when all content entries are invalid', () => {
    const result = sanitizeLogprobs({
      content: [
        null,
        { token: 42, logprob: -0.1, bytes: null },
        { token: 'bad', logprob: NaN, bytes: null },
      ],
    });
    // All invalid → sanitizeLogprobContentArray returns null → both null → undefined
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. sanitizeLogprobs — prototype-pollution in top_logprobs entries
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — prototype-pollution in top_logprobs', () => {
  it('filters out top_logprobs entries with __proto__ key', () => {
    const badTop = Object.create(null);
    badTop.token = 'bad';
    badTop.logprob = -0.5;
    badTop.bytes = null;
    badTop['__proto__'] = 'polluted';

    const result = sanitizeLogprobs({
      content: [validContentEntry('main', -0.2, null, [badTop, validEntry('good', -0.3, null)])],
    });
    expect(result!.content![0].top_logprobs).toHaveLength(1);
    expect(result!.content![0].top_logprobs[0].token).toBe('good');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. sanitizeLogprobs — logprob edge values
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — logprob edge values', () => {
  it('accepts negative zero logprob (preserved as -0)', () => {
    const result = sanitizeLogprobs({
      content: [validContentEntry('a', -0, null)],
    });
    // -0 is a valid finite number; sanitizer preserves it
    expect(Number.isFinite(result!.content![0].logprob)).toBe(true);
    expect(result!.content![0].logprob).toBe(-0);
  });

  it('accepts very negative logprob', () => {
    const result = sanitizeLogprobs({
      content: [validContentEntry('a', -100.5, null)],
    });
    expect(result!.content![0].logprob).toBe(-100.5);
  });

  it('accepts zero logprob', () => {
    const result = sanitizeLogprobs({
      content: [validContentEntry('a', 0, null)],
    });
    expect(result!.content![0].logprob).toBe(0);
  });

  it('accepts positive logprob (unusual but valid)', () => {
    const result = sanitizeLogprobs({
      content: [validContentEntry('a', 1.5, null)],
    });
    expect(result!.content![0].logprob).toBe(1.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. sanitizeLogprobs — token truncation in top_logprobs
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — token truncation in top_logprobs', () => {
  it('truncates long tokens in top_logprobs entries', () => {
    const longToken = 'z'.repeat(600);
    const result = sanitizeLogprobs({
      content: [validContentEntry('main', -0.1, null, [validEntry(longToken, -0.5, null)])],
    });
    expect(result!.content![0].top_logprobs[0].token).toHaveLength(512);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. sanitizeLogprobs — empty token string is accepted
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — empty token string', () => {
  it('accepts empty string token (valid for some tokenizers)', () => {
    const result = sanitizeLogprobs({
      content: [validContentEntry('', -0.1, null)],
    });
    expect(result!.content![0].token).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. sanitizeLogprobs — content entry with extra properties stripped
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeLogprobs — allowlist strips extra properties', () => {
  it('does not forward unexpected extra properties from content entries', () => {
    const result = sanitizeLogprobs({
      content: [
        {
          token: 'hi',
          logprob: -0.5,
          bytes: null,
          top_logprobs: [],
          extra_field: 'should be stripped',
          secret: 'api-key-123',
        },
      ],
    });
    const entry = result!.content![0] as Record<string, unknown>;
    expect(entry.token).toBe('hi');
    expect(entry.extra_field).toBeUndefined();
    expect(entry.secret).toBeUndefined();
  });

  it('does not forward extra properties from top_logprobs entries', () => {
    const result = sanitizeLogprobs({
      content: [
        validContentEntry('main', -0.1, null, [
          { token: 'top', logprob: -0.3, bytes: null, extra: 'stripped' },
        ]),
      ],
    });
    const topEntry = result!.content![0].top_logprobs[0] as Record<string, unknown>;
    expect(topEntry.extra).toBeUndefined();
  });
});
