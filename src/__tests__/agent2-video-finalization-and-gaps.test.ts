/**
 * Agent 2 — Video finalization edge cases + remaining embed_text/decide gaps.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file only
 * adds NEW test cases in src/__tests__/ and does NOT modify source code.
 *
 * Covers genuinely untested paths:
 *
 * handleGetVideoStatus — completed job flow:
 *  1. completed job downloads and returns content (no save_path)
 *  2. completed job downloads and saves to save_path with correct extension
 *  3. completed job with webm content type → .webm extension
 *  4. completed job with quicktime content type → .mov extension
 *  5. completed job with mpeg content type → .mpeg extension
 *  6. completed job with HTML MIME (CDN error page) → UPSTREAM_HTTP
 *  7. completed job with application/xhtml+xml MIME → UPSTREAM_HTTP
 *  8. completed job with no unsigned_urls → UPSTREAM_HTTP
 *  9. completed job with empty buffer → UPSTREAM_HTTP
 * 10. completed job download throws "too large" → RESOURCE_TOO_LARGE
 * 11. completed job download throws generic error → UPSTREAM_HTTP
 * 12. handleGetVideoStatus trims whitespace from video_id
 *
 * handleGenerateVideo — extension mismatch:
 * 13. save_path extension differs from detected MIME → replaces extension
 *
 * handleGenerateVideo — video_id missing from envelope:
 * 14. envelope without id → UPSTREAM_HTTP
 *
 * embed_text — remaining boundary cases:
 * 15. total chars at exactly 10_000_000 passes
 * 16. response.model is empty string → falls back to effectiveModel
 * 17. data is a non-empty string (truthy, non-array) → INTERNAL
 * 18. data is a plain object (truthy, non-array) → INTERNAL
 *
 * decide — remaining boundary cases:
 * 19. instructions at exactly 10_000 chars passes
 * 20. criteria key at exactly 256 chars passes
 * 21. model at exactly 256 chars passes for decide
 * 22. state that is deeply nested but safe passes (> 32 depth, scanning stops)
 * 23. choice criteria with exactly 100 entries passes
 * 24. empty response model falls back to effectiveModel in _meta
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { handleGenerateVideo, handleGetVideoStatus } from '../tool-handlers/generate-video.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { SERVER_VERSION } from '../version.js';

// ─── Type helpers ────────────────────────────────────────────────────────────

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  _meta: Record<string, unknown>;
  isError?: false;
};

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

// ─── Mock factories ──────────────────────────────────────────────────────────

function mkVideoClient(plan: Partial<OpenRouterAPIClient>): OpenRouterAPIClient {
  return plan as unknown as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown, throws?: Error) {
  const createEmbeddings = vi.fn();
  if (throws) createEmbeddings.mockRejectedValue(throws);
  else createEmbeddings.mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown, throws?: Error) {
  const submitDecision = vi.fn();
  if (throws) submitDecision.mockRejectedValue(throws);
  else submitDecision.mockResolvedValue(response);
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

// ═══════════════════════════════════════════════════════════════════════════════
// 1–12. handleGetVideoStatus — completed job flow
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleGetVideoStatus — completed job download flow', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'mcp-vid-status-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('downloads and returns content for completed job (no save_path)', async () => {
    const mp4 = Buffer.from('fake-mp4-data');
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v1',
      status: 'completed',
      unsigned_urls: ['https://example.com/v1.mp4'],
      usage: { duration_s: 4 },
    });
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: mp4,
      contentType: 'video/mp4',
    });
    const client = mkVideoClient({ pollVideoJob, downloadVideoContent });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v1' } } },
      client,
    )) as SuccessResult;

    expect(r.isError).toBeFalsy();
    expect(r._meta.video_id).toBe('v1');
    expect(r._meta.mime).toBe('video/mp4');
    expect(r._meta.size_bytes).toBe(mp4.length);
    expect(r._meta.usage).toEqual({ duration_s: 4 });
    expect(downloadVideoContent).toHaveBeenCalledWith('v1', 0, expect.any(Number));
  });

  it('saves completed video to save_path with correct extension', async () => {
    const mp4 = Buffer.from('fake-mp4-bytes-longer');
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v2',
      status: 'completed',
      unsigned_urls: ['https://example.com/v2.mp4'],
    });
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: mp4,
      contentType: 'video/mp4',
    });
    const client = mkVideoClient({ pollVideoJob, downloadVideoContent });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v2', save_path: 'result.mp4' } } },
      client,
    )) as SuccessResult;

    expect(r.isError).toBeFalsy();
    expect(r._meta.save_path).toBeDefined();
    const saved = r._meta.save_path as string;
    expect(saved.endsWith('.mp4')).toBe(true);
  });

  it('maps video/webm content type to .webm extension', async () => {
    const webm = Buffer.from('fake-webm-content');
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v3',
      status: 'completed',
      unsigned_urls: ['https://example.com/v3.webm'],
    });
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: webm,
      contentType: 'video/webm',
    });
    const client = mkVideoClient({ pollVideoJob, downloadVideoContent });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v3', save_path: 'out.mp4' } } },
      client,
    )) as SuccessResult;

    expect(r.isError).toBeFalsy();
    const saved = r._meta.save_path as string;
    expect(saved.endsWith('.webm')).toBe(true);
  });

  it('maps video/quicktime content type to .mov extension', async () => {
    const mov = Buffer.from('fake-quicktime-content');
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v4',
      status: 'completed',
      unsigned_urls: ['https://example.com/v4.mov'],
    });
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: mov,
      contentType: 'video/quicktime',
    });
    const client = mkVideoClient({ pollVideoJob, downloadVideoContent });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v4', save_path: 'clip.mp4' } } },
      client,
    )) as SuccessResult;

    expect(r.isError).toBeFalsy();
    const saved = r._meta.save_path as string;
    expect(saved.endsWith('.mov')).toBe(true);
  });

  it('maps video/mpeg content type to .mpeg extension', async () => {
    const mpeg = Buffer.from('fake-mpeg-content');
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v5',
      status: 'completed',
      unsigned_urls: ['https://example.com/v5.mpeg'],
    });
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: mpeg,
      contentType: 'video/mpeg',
    });
    const client = mkVideoClient({ pollVideoJob, downloadVideoContent });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v5', save_path: 'clip.mp4' } } },
      client,
    )) as SuccessResult;

    expect(r.isError).toBeFalsy();
    const saved = r._meta.save_path as string;
    expect(saved.endsWith('.mpeg')).toBe(true);
  });

  it('returns UPSTREAM_HTTP when CDN returns text/html (HTML error page)', async () => {
    const htmlBody = Buffer.from('<html><body>502 Bad Gateway</body></html>');
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v6',
      status: 'completed',
      unsigned_urls: ['https://example.com/v6.mp4'],
    });
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: htmlBody,
      contentType: 'text/html',
    });
    const client = mkVideoClient({ pollVideoJob, downloadVideoContent });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v6' } } },
      client,
    )) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('text/html');
  });

  it('returns UPSTREAM_HTTP when CDN returns application/xhtml+xml', async () => {
    const xhtml = Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml">Error</html>');
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v7',
      status: 'completed',
      unsigned_urls: ['https://example.com/v7.mp4'],
    });
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: xhtml,
      contentType: 'application/xhtml+xml',
    });
    const client = mkVideoClient({ pollVideoJob, downloadVideoContent });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v7' } } },
      client,
    )) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('xhtml+xml');
  });

  it('returns UPSTREAM_HTTP when completed job has no unsigned_urls', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v8',
      status: 'completed',
      // no unsigned_urls field at all
    });
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: Buffer.from('data'),
      contentType: 'video/mp4',
    });
    const client = mkVideoClient({ pollVideoJob, downloadVideoContent });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v8' } } },
      client,
    )) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('no content URL');
  });

  it('returns UPSTREAM_HTTP when completed job download is empty', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v9',
      status: 'completed',
      unsigned_urls: ['https://example.com/v9.mp4'],
    });
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: Buffer.alloc(0),
      contentType: 'video/mp4',
    });
    const client = mkVideoClient({ pollVideoJob, downloadVideoContent });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v9' } } },
      client,
    )) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });

  it('maps "too large" download error to RESOURCE_TOO_LARGE', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v10',
      status: 'completed',
      unsigned_urls: ['https://example.com/v10.mp4'],
    });
    const downloadVideoContent = vi
      .fn()
      .mockRejectedValue(new Error('Video content too large: 300MB exceeds limit'));
    const client = mkVideoClient({ pollVideoJob, downloadVideoContent });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v10' } } },
      client,
    )) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('RESOURCE_TOO_LARGE');
  });

  it('maps generic download error to UPSTREAM_HTTP', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v11',
      status: 'completed',
      unsigned_urls: ['https://example.com/v11.mp4'],
    });
    const downloadVideoContent = vi.fn().mockRejectedValue(new Error('Network connection reset'));
    const client = mkVideoClient({ pollVideoJob, downloadVideoContent });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v11' } } },
      client,
    )) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });

  it('trims whitespace from video_id before calling API', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v12',
      status: 'processing',
    });
    const client = mkVideoClient({ pollVideoJob });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: '  v12  ' } } },
      client,
    )) as SuccessResult;

    expect(r.isError).toBeFalsy();
    expect(pollVideoJob).toHaveBeenCalledWith('v12');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13–14. handleGenerateVideo — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleGenerateVideo — save_path extension mismatch', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'mcp-vid-ext-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('replaces save_path extension when MIME differs from requested', async () => {
    vi.useRealTimers();
    const webmData = Buffer.from('fake-webm-video');
    const submitVideoJob = vi.fn().mockResolvedValue({
      id: 'vid_ext',
      status: 'pending',
    });
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'vid_ext',
      status: 'completed',
      unsigned_urls: ['https://example.com/vid.webm'],
    });
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: webmData,
      contentType: 'video/webm',
    });
    const client = mkVideoClient({ submitVideoJob, pollVideoJob, downloadVideoContent });

    const r = (await handleGenerateVideo(
      {
        params: {
          arguments: {
            prompt: 'a cat',
            save_path: 'output.mp4',
            poll_interval_ms: 50,
            max_wait_ms: 5000,
          },
        },
      },
      client,
    )) as SuccessResult;

    expect(r.isError).toBeFalsy();
    const saved = r._meta.save_path as string;
    expect(saved.endsWith('.webm')).toBe(true);
    // Verify the summary note about extension change
    expect(r.content[0].text).toContain('detected');
    expect(r.content[0].text).toContain('webm');
  });
});

describe('handleGenerateVideo — envelope without id', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'mcp-vid-noid-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('returns UPSTREAM_HTTP when envelope has no id', async () => {
    const submitVideoJob = vi.fn().mockResolvedValue({
      status: 'pending',
      // no id field
    });
    const client = mkVideoClient({ submitVideoJob });

    const r = (await handleGenerateVideo(
      { params: { arguments: { prompt: 'a sunset' } } },
      client,
    )) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('job id');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15–18. handleEmbedText — remaining boundary cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — total input chars boundary', () => {
  it('passes when total chars are exactly at 10_000_000', async () => {
    // 200 texts × 50_000 chars each = exactly 10_000_000.
    // Each text is under the 100_000 per-text limit.
    const text = 'a'.repeat(50_000);
    const texts = Array.from({ length: 200 }, () => text);
    const client = mockEmbedClient({
      data: texts.map((_, i) => ({ index: i, embedding: [0.1] })),
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts }), client)) as SuccessResult;
    expect(r.content).toBeDefined();
    expect(r._meta.embedding_count).toBe(200);
  });
});

describe('handleEmbedText — response.model empty string fallback', () => {
  it('falls back to effectiveModel when response.model is empty string', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5, 0.6] }],
      model: '',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'test', model: 'voyage/voyage-3' }),
      client,
    )) as SuccessResult;

    // Empty string is falsy → falls back to effectiveModel
    expect(r.structuredContent).toBeDefined();
    const sc = r.structuredContent as { model: string };
    expect(sc.model).toBe('voyage/voyage-3');
    expect(r._meta.model).toBe('voyage/voyage-3');
  });
});

describe('handleEmbedText — non-array truthy data field', () => {
  it('returns INTERNAL when data is a non-empty string', async () => {
    const client = mockEmbedClient({
      data: 'not an array',
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  it('returns INTERNAL when data is a plain object', async () => {
    const client = mockEmbedClient({
      data: { index: 0, embedding: [0.1] },
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 19–24. handleDecide — remaining boundary cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleDecide — instructions at boundary length', () => {
  it('accepts instructions at exactly 10_000 characters', async () => {
    const instructions = 'a'.repeat(10_000);
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions, criteria: { yes: 'y', no: 'n' } },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

describe('handleDecide — criteria key at boundary length', () => {
  it('accepts criteria key at exactly 256 characters', async () => {
    const longKey = 'k'.repeat(256);
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { [longKey]: 'val1', short: 'val2' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

describe('handleDecide — model at boundary length', () => {
  it('accepts model at exactly 256 characters', async () => {
    const longModel = 'm'.repeat(256);
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQuestion() },
        model: longModel,
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect(r._meta.model).toBe(longModel);
  });
});

describe('handleDecide — deeply nested safe state', () => {
  it('passes deeply nested state with no unsafe keys (scanning stops at depth 32)', async () => {
    // Build a chain of 40 nested objects — beyond the MAX_STATE_NESTING_DEPTH of 32
    let state: Record<string, unknown> = { leaf: 'value' };
    for (let i = 0; i < 40; i++) {
      state = { nested: state };
    }
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQuestion() },
        state,
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

describe('handleDecide — choice criteria at exact boundary', () => {
  it('accepts exactly 100 criteria entries for noul type', async () => {
    const criteria: Record<string, string> = {};
    for (let i = 0; i < 100; i++) criteria[`opt${i}`] = `option ${i}`;
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'noul', instructions: 'test', criteria },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

describe('handleDecide — response model fallback', () => {
  it('uses effectiveModel in _meta when custom model is provided but no usage', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQuestion() },
        model: 'upstage/solar-decide',
      }),
      client,
    )) as SuccessResult;
    expect(r._meta.model).toBe('upstage/solar-decide');
    expect(r._meta.server_version).toBe(SERVER_VERSION);
    expect(r._meta.usage).toBeUndefined();
  });
});

describe('handleDecide — score level at exact boundary length', () => {
  it('accepts score level at exactly 10_000 characters', async () => {
    const longLevel = 'x'.repeat(10_000);
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.3, 0.7] } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate quality',
            criteria: ['short', longLevel],
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

describe('handleDecide — criteria value at exact boundary length', () => {
  it('accepts criteria value at exactly 10_000 characters for noul type', async () => {
    const longVal = 'v'.repeat(10_000);
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: longVal, no: 'short' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

describe('handleDecide — score criteria at exact 100 levels', () => {
  it('accepts exactly 100 score levels', async () => {
    const criteria = Array.from({ length: 100 }, (_, i) => `level ${i}`);
    const client = mockDecideClient({
      answers: {
        q1: {
          type: 'score',
          score: Array.from({ length: 100 }, () => 0.01),
        },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });
});

describe('handleGetVideoStatus — progress field in processing response', () => {
  it('includes progress in _meta when status is processing with progress', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'vprog',
      status: 'processing',
      progress: 0.45,
    });
    const client = mkVideoClient({ pollVideoJob });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'vprog' } } },
      client,
    )) as SuccessResult;

    expect(r.isError).toBeFalsy();
    expect(r._meta.progress).toBe(0.45);
    expect(r.content[0].text).toContain('progress=0.45');
  });

  it('omits progress from text when not present', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'vnoprog',
      status: 'processing',
    });
    const client = mkVideoClient({ pollVideoJob });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'vnoprog' } } },
      client,
    )) as SuccessResult;

    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).not.toContain('progress=');
  });
});

describe('handleGetVideoStatus — upstream poll error', () => {
  it('classifies poll HTTP errors', async () => {
    const pollVideoJob = vi
      .fn()
      .mockRejectedValue(new Error('POST /videos/vfail failed: HTTP 500'));
    const client = mkVideoClient({ pollVideoJob });

    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 'vfail' } } },
      client,
    )) as ErrorResult;

    expect(r.isError).toBe(true);
  });
});

describe('handleGetVideoStatus — non-string video_id type', () => {
  it('returns INVALID_INPUT when video_id is a number', async () => {
    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 42 as unknown as string } } },
      mkVideoClient({}),
    )) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});
