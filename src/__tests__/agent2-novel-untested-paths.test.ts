/**
 * Agent 2 — Novel untested paths across embed_text, decide, and low-coverage utilities.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file only
 * adds NEW test cases in src/__tests__/ and does NOT modify source code.
 *
 * Genuinely untested paths (verified via exhaustive grep across all test files):
 *
 * decide — default switch case `rawType` validation:
 *  1. Numeric rawType (type: 42) → safeType = 'unknown' (non-string fallback)
 *  2. Boolean rawType (type: true) → safeType = 'unknown'
 *  3. Null rawType (type: null) → safeType = 'unknown'
 *  4. Long string rawType (>256 chars) → truncated to 256 chars
 *  5. String rawType at exactly 256 chars → preserved as-is
 *
 * openai-withresponse.ts — awaitCompletionWithHeaders:
 *  6. Call with withResponse() available → returns { data, response }
 *  7. Call without withResponse() → returns { data, response: undefined }
 *  8. Call with withResponse that throws → error propagates
 *
 * generate-image-input.ts — buildUserContent:
 *  9. Prompt only (no images) → simple string
 * 10. Prompt with one image → multipart array with text + image_url
 * 11. Prompt with multiple images → multipart array with text + N image_urls
 * 12. Prompt with empty array → simple string (same as no images)
 *
 * embed_text — metadata dimensions consistency when vectors are capped:
 * 13. Oversized vectors (>65_536) report sanitized dimensions in metadata, not raw
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleDecide } from '../tool-handlers/decide.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { awaitCompletionWithHeaders } from '../tool-handlers/openai-withresponse.js';
import { buildUserContent } from '../tool-handlers/generate-image-input.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

type DecideSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    answers: Record<
      string,
      {
        type: string;
        noul?: number;
        choice?: Record<string, number>;
        score?: number[];
      }
    >;
  };
  _meta: Record<string, unknown>;
};

type EmbedSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
};

function mockDecideClient(response: unknown) {
  const submitDecision = vi.fn().mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown) {
  const createEmbeddings = vi.fn().mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function noulQuestion() {
  return {
    type: 'noul' as const,
    instructions: 'Is the sky blue?',
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–5. decide — default switch case rawType validation
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — unknown answer type rawType sanitization', () => {
  it('uses safeType "unknown" when rawType is a number (42)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 42, value: 'stripped' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // typeof 42 !== 'string' → safeType = 'unknown'
    expect(r.structuredContent.answers.q1).toBeDefined();
    expect(r.structuredContent.answers.q1.type).toBe('unknown');
    // Extra properties should be stripped
    expect((r.structuredContent.answers.q1 as Record<string, unknown>).value).toBeUndefined();
  });

  it('uses safeType "unknown" when rawType is boolean (true)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: true, data: 'leaked' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1.type).toBe('unknown');
    expect((r.structuredContent.answers.q1 as Record<string, unknown>).data).toBeUndefined();
  });

  it('uses safeType "unknown" when rawType is null', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: null, extra: {} } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1.type).toBe('unknown');
    expect((r.structuredContent.answers.q1 as Record<string, unknown>).extra).toBeUndefined();
  });

  it('truncates long string rawType to 256 chars', async () => {
    const longType = 'x'.repeat(300);
    const client = mockDecideClient({
      answers: { q1: { type: longType, value: 'stripped' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // String > 256 → sliced to 256
    expect(r.structuredContent.answers.q1.type).toBe('x'.repeat(256));
    expect(r.structuredContent.answers.q1.type.length).toBe(256);
    expect((r.structuredContent.answers.q1 as Record<string, unknown>).value).toBeUndefined();
  });

  it('preserves string rawType at exactly 256 chars without truncation', async () => {
    const exactType = 'a'.repeat(256);
    const client = mockDecideClient({
      answers: { q1: { type: exactType } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1.type).toBe(exactType);
    expect(r.structuredContent.answers.q1.type.length).toBe(256);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6–8. awaitCompletionWithHeaders — both branches
// ═══════════════════════════════════════════════════════════════════════════

describe('awaitCompletionWithHeaders', () => {
  it('uses withResponse() when available and returns data + response', async () => {
    const mockData = { id: 'chatcmpl-1', choices: [] };
    const mockResponse = new Response('{}', { status: 200 });
    const callObj = {
      withResponse: vi.fn().mockResolvedValue({ data: mockData, response: mockResponse }),
    };
    const result = await awaitCompletionWithHeaders(callObj);
    expect(callObj.withResponse).toHaveBeenCalledOnce();
    expect(result.data).toBe(mockData);
    expect(result.response).toBe(mockResponse);
  });

  it('falls back to plain promise when withResponse() is not available', async () => {
    const mockData = { id: 'chatcmpl-2', choices: [] };
    const plainPromise = Promise.resolve(mockData);
    const result = await awaitCompletionWithHeaders(plainPromise);
    expect(result.data).toBe(mockData);
    expect(result.response).toBeUndefined();
  });

  it('propagates errors from withResponse()', async () => {
    const callObj = {
      withResponse: vi.fn().mockRejectedValue(new Error('upstream failure')),
    };
    await expect(awaitCompletionWithHeaders(callObj)).rejects.toThrow('upstream failure');
  });

  it('propagates errors from plain promise', async () => {
    const failingPromise = Promise.reject(new Error('network error'));
    await expect(awaitCompletionWithHeaders(failingPromise)).rejects.toThrow('network error');
  });

  it('falls back to plain promise when call object has no withResponse method', async () => {
    // Object without withResponse — should treat as a plain promise via `await call`
    const mockData = { id: 'chatcmpl-3', choices: [] };
    const callObj = { then: vi.fn((resolve: (v: unknown) => void) => resolve(mockData)) };
    const result = await awaitCompletionWithHeaders(callObj);
    expect(result.data).toBe(mockData);
    expect(result.response).toBeUndefined();
  });

  it('handles null call object gracefully (falls through to plain await)', async () => {
    // `null?.withResponse` is undefined → falls to plain `await null` → data = null
    const result = await awaitCompletionWithHeaders(null);
    expect(result.data).toBeNull();
    expect(result.response).toBeUndefined();
  });

  it('handles undefined call object gracefully', async () => {
    const result = await awaitCompletionWithHeaders(undefined);
    expect(result.data).toBeUndefined();
    expect(result.response).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9–12. buildUserContent — prompt with and without images
// ═══════════════════════════════════════════════════════════════════════════

describe('buildUserContent', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'build-user-content-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', sandbox);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('returns simple string when no input images are provided', async () => {
    const result = await buildUserContent('a sunset over mountains');
    expect(typeof result).toBe('string');
    expect(result).toBe('Generate an image: a sunset over mountains');
  });

  it('returns simple string when input images array is empty', async () => {
    const result = await buildUserContent('a sunset over mountains', []);
    expect(typeof result).toBe('string');
    expect(result).toBe('Generate an image: a sunset over mountains');
  });

  it('returns simple string when input images is undefined', async () => {
    const result = await buildUserContent('test prompt', undefined);
    expect(typeof result).toBe('string');
    expect(result).toContain('test prompt');
  });

  it('returns multipart array with text + image_url for single image URL', async () => {
    const result = await buildUserContent('edit this photo', ['https://example.com/photo.jpg']);
    expect(Array.isArray(result)).toBe(true);
    const parts = result as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('edit this photo');
    expect(parts[0].text).toContain('reference image');
    expect(parts[1].type).toBe('image_url');
    expect(parts[1].image_url?.url).toBe('https://example.com/photo.jpg');
  });

  it('returns multipart array with N image_urls for multiple images', async () => {
    const result = await buildUserContent('combine these', [
      'https://example.com/a.jpg',
      'https://example.com/b.png',
      'https://example.com/c.webp',
    ]);
    expect(Array.isArray(result)).toBe(true);
    const parts = result as Array<{ type: string; image_url?: { url: string; detail: string } }>;
    // 1 text part + 3 image parts
    expect(parts).toHaveLength(4);
    expect(parts[0].type).toBe('text');
    expect(parts[1].type).toBe('image_url');
    expect(parts[2].type).toBe('image_url');
    expect(parts[3].type).toBe('image_url');
    expect(parts[1].image_url?.detail).toBe('high');
    expect(parts[2].image_url?.detail).toBe('high');
    expect(parts[3].image_url?.detail).toBe('high');
  });

  it('resolves local file paths for input images', async () => {
    // Create a small test JPEG (minimal valid header)
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const testFile = path.join(sandbox, 'test.jpg');
    await fs.writeFile(testFile, jpegHeader);

    const result = await buildUserContent('enhance this', [testFile]);
    expect(Array.isArray(result)).toBe(true);
    const parts = result as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts).toHaveLength(2);
    expect(parts[1].type).toBe('image_url');
    // Local files are converted to data URIs
    expect(parts[1].image_url?.url).toMatch(/^data:image\//);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. embed_text — metadata dimensions consistency when vectors are capped
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — metadata dimensions reflects sanitized vector length', () => {
  it('reports sanitized dimensions (65_536) when upstream returns oversized vectors', async () => {
    const oversized = new Array(70_000).fill(0.1);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: oversized }],
      model: 'test/big-model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;

    // Vector capped to 65_536
    expect(r.structuredContent.embeddings[0].embedding).toHaveLength(65_536);
    // structuredContent.dimensions should match the sanitized length, not 70_000
    expect(r.structuredContent.dimensions).toBe(65_536);
    // _meta.dimensions must also match
    expect(r._meta.dimensions).toBe(65_536);
    // Summary text should say 65536, not 70000
    expect(r.content[0].text).toContain('65536 dimensions');
    expect(r.content[0].text).not.toContain('70000');
  });

  it('reports correct dimensions for normal-sized vectors (no capping)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;

    expect(r.structuredContent.dimensions).toBe(5);
    expect(r._meta.dimensions).toBe(5);
    expect(r.content[0].text).toContain('5 dimensions');
  });

  it('dimensions metadata is consistent across batch with mixed vector sizes', async () => {
    // First embedding has 3 dims, second has 70_000 (capped to 65_536)
    // sanitizedDimensions is based on first element's sanitized length
    const oversized = new Array(70_000).fill(0.1);
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3] },
        { index: 1, embedding: oversized },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;

    // First embedding drives the reported dimensions
    expect(r.structuredContent.dimensions).toBe(3);
    expect(r._meta.dimensions).toBe(3);
    // But second embedding is separately capped at 65_536
    expect(r.structuredContent.embeddings[1].embedding).toHaveLength(65_536);
  });
});
