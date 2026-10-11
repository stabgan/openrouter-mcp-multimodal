/**
 * Agent 2 — Coverage for genuinely untested code paths in video-utils,
 * embed_text, and decide handlers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets (confirmed untested via exhaustive grep of all src/__tests__/):
 *
 * video-utils.ts — detectVideoFormat:
 *  1. MPEG-PS 0xe0 start code (only 0xba and 0xb3 are tested)
 *  2. ftyp with 'mov ' brand (only 'qt  ' is tested)
 *  3. Buffer 4–11 bytes containing ftyp magic → should NOT match ftyp (too short)
 *  4. Single 0x47 at offset 0 with buffer < 377 bytes → should NOT match MPEG-TS
 *  5. Single 0x47 at offset 0, buffer >= 377, but no 0x47 at offset 188 → undefined
 *
 * video-utils.ts — prepareVideoData (data URL edge cases):
 *  6. data:video/quicktime MIME → format 'mov'
 *  7. data:video/mp2t MIME → format 'mpeg'
 *  8. data:video/x-m4v MIME → format 'mp4'
 *  9. data:video/x-quicktime MIME → format 'mov'
 * 10. Invalid (non-parseable) video data URL → throw
 * 11. Empty data URL payload (0 bytes) → throw
 *
 * video-utils.ts — prepareVideoData (local file edge cases):
 * 12. Empty local file (0 bytes) → throw
 *
 * embed_text — scalar type edge cases:
 * 13. texts: true (boolean scalar) — wraps to [true], fails type check
 * 14. texts: {} (object scalar) — wraps to [{}], fails type check
 *
 * decide — response formatting:
 * 15. noul with -Infinity → typeof=number, isFinite=false → defaults to 0
 * 16. score with single valid entry among non-numbers → picks correct index
 * 17. choice with Infinity probability → sorted correctly
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  detectVideoFormat,
  getVideoFormat,
  prepareVideoData,
} from '../tool-handlers/video-utils.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { withInputSandbox } from './helpers/input-sandbox.js';

// ---------------------------------------------------------------------------
// Helpers — embed_text
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

function mockEmbedClient(response: unknown) {
  const createEmbeddings = vi.fn().mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  const submitDecision = vi.fn().mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQuestion(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

function scoreQuestion(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

function choiceQuestion(instructions = 'Pick a color') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { red: 'Color red', blue: 'Color blue', green: 'Color green' },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. detectVideoFormat — MPEG-PS 0xe0 start code
// ═══════════════════════════════════════════════════════════════════════════

describe('detectVideoFormat — MPEG-PS 0xe0 start code', () => {
  it('detects MPEG via 0x00 0x00 0x01 0xe0 start code', () => {
    const buf = Buffer.from([0x00, 0x00, 0x01, 0xe0]);
    expect(detectVideoFormat(buf)).toBe('mpeg');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. detectVideoFormat — ftyp with 'mov ' brand
// ═══════════════════════════════════════════════════════════════════════════

describe('detectVideoFormat — ftyp with mov brand', () => {
  it('detects QuickTime via ftyp with "mov " brand', () => {
    const buf = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x14]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('mov ', 'ascii'),
    ]);
    expect(detectVideoFormat(buf)).toBe('mov');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. detectVideoFormat — buffer too short for ftyp (4–11 bytes)
// ═══════════════════════════════════════════════════════════════════════════

describe('detectVideoFormat — short buffer with ftyp-like magic', () => {
  it('does NOT match ftyp with only 8 bytes (need 12 for brand)', () => {
    // buffer.length < 12 → ftyp check skipped; 8 bytes also too short for MPEG-TS
    const buf = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x14]),
      Buffer.from('ftyp', 'ascii'),
    ]);
    expect(buf.length).toBe(8);
    // Falls through to EBML/MPEG-PS checks, neither match → undefined
    expect(detectVideoFormat(buf)).toBeUndefined();
  });

  it('does NOT match ftyp with only 11 bytes (one short of required 12)', () => {
    const buf = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x14]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('iso', 'ascii'), // only 3 bytes of brand, need 4
    ]);
    expect(buf.length).toBe(11);
    expect(detectVideoFormat(buf)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4–5. detectVideoFormat — MPEG-TS false positive prevention
// ═══════════════════════════════════════════════════════════════════════════

describe('detectVideoFormat — MPEG-TS false positive prevention', () => {
  it('returns undefined when 0x47 at offset 0 but buffer < 377 bytes', () => {
    // A file starting with 'G' (0x47) but too short for TS sync verification
    const buf = Buffer.alloc(200);
    buf[0] = 0x47;
    buf[188] = 0x47; // Would match if long enough, but buffer.length < 377
    expect(detectVideoFormat(buf)).toBeUndefined();
  });

  it('returns undefined when 0x47 at offset 0, buffer >= 377, but no 0x47 at offset 188', () => {
    const buf = Buffer.alloc(400);
    buf[0] = 0x47;
    buf[188] = 0x00; // NOT 0x47 — fails second sync check
    expect(detectVideoFormat(buf)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6–9. prepareVideoData — data URL MIME subtype variants
// ═══════════════════════════════════════════════════════════════════════════

describe('prepareVideoData — data URL MIME variants', () => {
  const payload = Buffer.from('fake-video-bytes').toString('base64');

  it('parses data:video/quicktime as mov format', async () => {
    const r = await prepareVideoData(`data:video/quicktime;base64,${payload}`);
    expect(r.format).toBe('mov');
    expect(r.mediaType).toBe('video/quicktime');
  });

  it('parses data:video/mp2t as mpeg format', async () => {
    const r = await prepareVideoData(`data:video/mp2t;base64,${payload}`);
    expect(r.format).toBe('mpeg');
    expect(r.mediaType).toBe('video/mpeg');
  });

  it('parses data:video/x-m4v as mp4 format', async () => {
    const r = await prepareVideoData(`data:video/x-m4v;base64,${payload}`);
    expect(r.format).toBe('mp4');
    expect(r.mediaType).toBe('video/mp4');
  });

  it('parses data:video/x-quicktime as mov format', async () => {
    const r = await prepareVideoData(`data:video/x-quicktime;base64,${payload}`);
    expect(r.format).toBe('mov');
    expect(r.mediaType).toBe('video/quicktime');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. prepareVideoData — invalid (non-parseable) data URL
// ═══════════════════════════════════════════════════════════════════════════

describe('prepareVideoData — invalid data URL', () => {
  it('rejects a malformed data URL (no base64 payload)', async () => {
    await expect(prepareVideoData('data:video/mp4')).rejects.toThrow('Invalid video data URL');
  });

  it('rejects a data URL with no MIME type', async () => {
    const payload = Buffer.from('x').toString('base64');
    // data:;base64,... — parseBase64DataUrl returns null for empty MIME
    await expect(prepareVideoData(`data:;base64,${payload}`)).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. prepareVideoData — empty data URL payload (0 bytes)
// ═══════════════════════════════════════════════════════════════════════════

describe('prepareVideoData — empty data URL payload', () => {
  it('rejects data URL with empty base64 content', async () => {
    // An empty base64 string decodes to 0 bytes
    await expect(prepareVideoData('data:video/mp4;base64,')).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. prepareVideoData — empty local file (0 bytes)
// ═══════════════════════════════════════════════════════════════════════════

describe('prepareVideoData — empty local file', () => {
  it('rejects a 0-byte video file', async () => {
    await withInputSandbox('mcp-vid-empty-', async (root) => {
      writeFileSync(path.join(root, 'empty.mp4'), Buffer.alloc(0));
      await expect(prepareVideoData('empty.mp4')).rejects.toThrow('empty (0 bytes)');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. handleEmbedText — scalar boolean wrapping
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — scalar type edge cases', () => {
  it('returns INVALID_INPUT when texts is a boolean true', async () => {
    // true is not undefined/null → Array.isArray(true) is false → [true]
    // typeof true !== 'string' → error at index 0
    const r = (await handleEmbedText(
      embedReq({ texts: true }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('returns INVALID_INPUT when texts is a plain object', async () => {
    // {} is not undefined/null/array → [{...}]
    // typeof {} !== 'string' → error at index 0
    const r = (await handleEmbedText(
      embedReq({ texts: { key: 'value' } }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. handleDecide — noul with -Infinity
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — noul with -Infinity value', () => {
  it('treats -Infinity noul as 0 (defaults to NO)', async () => {
    // typeof -Infinity === 'number' → true
    // Number.isFinite(-Infinity) → false → prob = 0
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -Infinity } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. handleDecide — score with single valid entry among non-numbers
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score with sparse valid entries', () => {
  it('picks the only valid numeric entry among non-numbers', async () => {
    // score[0] = 'bad' (non-number, skipped)
    // score[1] = null (non-number, skipped)
    // score[2] = 0.45 (valid, becomes max)
    // score[3] = undefined (non-number, skipped)
    const client = mockDecideClient({
      answers: {
        quality: { type: 'score', score: ['bad', null, 0.45, undefined] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { quality: scoreQuestion() } }),
      client,
    )) as SuccessResult;
    // Index 2 has the only valid value → level 3/4
    expect(r.content[0].text).toContain('level 3/4');
    expect(r.content[0].text).toContain('45.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. handleDecide — choice with Infinity probability value
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice with Infinity probability', () => {
  it('filters out Infinity as non-finite in choice sort', async () => {
    // Infinity is typeof 'number' but Number.isFinite(Infinity) is false
    // The filter in the summary: .filter(([k, v]) => !UNSAFE_KEYS.has(k) && typeof v === 'number' && Number.isFinite(v))
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: Infinity, b: 0.3, c: -Infinity } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as SuccessResult;
    // Infinity and -Infinity are filtered out by isFinite check
    // Only 'b' (0.3) survives → best option
    expect(r.content[0].text).toContain('b');
    expect(r.content[0].text).toContain('30.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. getVideoFormat — additional extension coverage
// ═══════════════════════════════════════════════════════════════════════════

describe('getVideoFormat — paths with multiple dots', () => {
  it('handles paths with directory dots correctly', () => {
    expect(getVideoFormat('/path/to/dir.name/video.mp4')).toBe('mp4');
    expect(getVideoFormat('./relative/../clip.webm')).toBe('webm');
  });

  it('handles uppercase/mixed-case extensions via path.extname', () => {
    expect(getVideoFormat('clip.MTS')).toBe('mpeg');
    expect(getVideoFormat('clip.M2TS')).toBe('mpeg');
    expect(getVideoFormat('clip.QT')).toBe('mov');
    expect(getVideoFormat('clip.WEBM')).toBe('webm');
    expect(getVideoFormat('clip.M4V')).toBe('mp4');
    expect(getVideoFormat('clip.MPG')).toBe('mpeg');
  });
});
