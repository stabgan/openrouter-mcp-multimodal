import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import {
  handleGenerateVideo,
  handleGetVideoStatus,
  _internals,
} from '../tool-handlers/generate-video.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

function mkApiClient(plan: Partial<OpenRouterAPIClient>): OpenRouterAPIClient {
  return plan as OpenRouterAPIClient;
}

describe('generate-video internals', () => {
  it('buildRequestBody propagates known keys only', () => {
    const body = _internals.buildRequestBody(
      {
        prompt: 'a cat',
        resolution: '720p',
        aspect_ratio: '16:9',
        duration: 8,
        seed: 42,
        provider: { 'google-vertex': { negative_prompt: 'blurry' } },
      },
      'google/veo-3.1',
    );
    expect(body).toEqual({
      model: 'google/veo-3.1',
      prompt: 'a cat',
      resolution: '720p',
      aspect_ratio: '16:9',
      duration: 8,
      seed: 42,
      provider: { 'google-vertex': { negative_prompt: 'blurry' } },
    });
  });

  it('stripAndReplaceExt swaps the extension', () => {
    expect(_internals.stripAndReplaceExt('/tmp/a.mov', '.mp4')).toBe('/tmp/a.mp4');
    expect(_internals.stripAndReplaceExt('/tmp/a', '.mp4')).toBe('/tmp/a.mp4');
  });

  it('extractJobError handles string and object errors', () => {
    expect(_internals.extractJobError({ id: 'x', status: 'failed', error: 'bad prompt' })).toBe(
      'bad prompt',
    );
    expect(
      _internals.extractJobError({
        id: 'x',
        status: 'failed',
        error: { message: 'model offline' },
      }),
    ).toBe('model offline');
    expect(_internals.extractJobError({ id: 'x', status: 'failed' })).toMatch(/failed/i);
  });
});

describe('handleGenerateVideo', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'mcp-gen-vid-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('rejects empty prompt', async () => {
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: '   ' } } },
      mkApiClient({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('happy path: submits, polls, downloads, saves', async () => {
    // Use REAL timers for this test so the async fs ops in path-safety can
    // proceed alongside the poll delays.
    vi.useRealTimers();

    const mp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from('ftypisom', 'ascii'),
      Buffer.alloc(64),
    ]);
    const submitVideoJob = vi.fn().mockResolvedValue({
      id: 'vid_abc',
      status: 'pending',
      polling_url: 'https://openrouter.ai/api/v1/videos/vid_abc',
    });
    const pollStates = [
      { id: 'vid_abc', status: 'processing' },
      {
        id: 'vid_abc',
        status: 'completed',
        unsigned_urls: ['https://openrouter.ai/api/v1/videos/vid_abc/content?index=0'],
        usage: { duration_s: 4 },
      },
    ];
    const pollVideoJob = vi.fn().mockImplementation(async () => pollStates.shift()!);
    const downloadVideoContent = vi.fn().mockResolvedValue({
      buffer: mp4,
      contentType: 'video/mp4',
    });
    const client = mkApiClient({ submitVideoJob, pollVideoJob, downloadVideoContent });

    const progress = vi.fn();
    const result = await handleGenerateVideo(
      {
        params: {
          arguments: {
            prompt: 'a calm river',
            save_path: 'out/river.mov',
            poll_interval_ms: 50,
            max_wait_ms: 10_000,
          },
        },
      },
      client,
      progress,
    );

    expect(result.isError).toBeFalsy();
    expect(submitVideoJob).toHaveBeenCalledOnce();
    expect(pollVideoJob).toHaveBeenCalledTimes(2);
    expect(downloadVideoContent).toHaveBeenCalledWith('vid_abc', 0, expect.any(Number));
    const savedPath = (result as { _meta: { save_path: string } })._meta.save_path;
    expect(savedPath.endsWith('.mp4')).toBe(true);
    expect(savedPath.startsWith(await fs.realpath(sandbox))).toBe(true);
    const types = (result as { content: Array<{ type: string }> }).content.map((c) => c.type);
    expect(types).toContain('text');
    expect(types).toContain('video');
    expect(progress).toHaveBeenCalled();
  }, 10_000);

  it('maps failed jobs to JOB_FAILED', async () => {
    vi.useRealTimers();
    const submitVideoJob = vi.fn().mockResolvedValue({ id: 'vid_f', status: 'pending' });
    const pollVideoJob = vi
      .fn()
      .mockResolvedValueOnce({ id: 'vid_f', status: 'processing' })
      .mockResolvedValueOnce({
        id: 'vid_f',
        status: 'failed',
        error: { message: 'content policy' },
      });
    const client = mkApiClient({ submitVideoJob, pollVideoJob });

    const r = await handleGenerateVideo(
      {
        params: {
          arguments: { prompt: 'x', poll_interval_ms: 50, max_wait_ms: 5000 },
        },
      },
      client,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('JOB_FAILED');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toBe('content policy');
  });

  it('returns JOB_STILL_RUNNING on timeout', async () => {
    vi.useRealTimers();
    const submitVideoJob = vi.fn().mockResolvedValue({ id: 'vid_t', status: 'pending' });
    const pollVideoJob = vi.fn().mockResolvedValue({ id: 'vid_t', status: 'processing' });
    const client = mkApiClient({ submitVideoJob, pollVideoJob });

    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'x', poll_interval_ms: 50, max_wait_ms: 200 } } },
      client,
    );
    expect(r.isError).toBeFalsy();
    expect((r as { _meta: { code: string } })._meta.code).toBe('JOB_STILL_RUNNING');
    expect((r as { _meta: { video_id: string } })._meta.video_id).toBe('vid_t');
  });

  it('maps HTTP 4xx submission errors to INVALID_INPUT', async () => {
    const submitVideoJob = vi
      .fn()
      .mockRejectedValue(new Error('POST /videos failed: HTTP 400 — bad prompt'));
    const r = await handleGenerateVideo(
      { params: { arguments: { prompt: 'x' } } },
      mkApiClient({ submitVideoJob }),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects save_path outside the sandbox', async () => {
    const submitVideoJob = vi.fn();
    const client = mkApiClient({ submitVideoJob });
    const r = await handleGenerateVideo(
      {
        params: {
          arguments: { prompt: 'x', save_path: '../escape.mp4' },
        },
      },
      client,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UNSAFE_PATH');
    // Pre-resolve should have short-circuited before hitting OpenRouter.
    expect(submitVideoJob).not.toHaveBeenCalled();
  });
});

describe('handleGetVideoStatus', () => {
  it('returns JOB_STILL_RUNNING when processing', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({ id: 'v', status: 'processing' });
    const r = await handleGetVideoStatus({ params: { arguments: { video_id: 'v' } } }, {
      pollVideoJob,
    } as unknown as OpenRouterAPIClient);
    expect(r.isError).toBeFalsy();
    expect((r as { _meta: { code: string } })._meta.code).toBe('JOB_STILL_RUNNING');
  });

  it('surfaces JOB_FAILED on failure', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v',
      status: 'failed',
      error: 'nope',
    });
    const r = await handleGetVideoStatus({ params: { arguments: { video_id: 'v' } } }, {
      pollVideoJob,
    } as unknown as OpenRouterAPIClient);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('JOB_FAILED');
  });

  it('returns INVALID_INPUT when video_id is missing', async () => {
    const r = await handleGetVideoStatus(
      { params: { arguments: { video_id: '' } } },
      {} as OpenRouterAPIClient,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });
});
