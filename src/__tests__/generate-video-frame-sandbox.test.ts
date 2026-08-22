import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { handleGenerateVideo } from '../tool-handlers/generate-video.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode } from '../errors.js';

describe('generate_video frame image sandbox', () => {
  let sandbox: string;
  let submitVideoJob: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'mcp-video-frame-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
    submitVideoJob = vi.fn();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  const api = (): OpenRouterAPIClient => ({ submitVideoJob }) as unknown as OpenRouterAPIClient;

  it('rejects unsafe first_frame_image before submitVideoJob', async () => {
    const r = await handleGenerateVideo(
      {
        params: {
          arguments: {
            prompt: 'zoom in',
            first_frame_image: '../etc/passwd',
          },
        },
      },
      api(),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UNSAFE_PATH);
    expect(submitVideoJob).not.toHaveBeenCalled();
  });

  it('rejects unsafe reference_images before submitVideoJob', async () => {
    const r = await handleGenerateVideo(
      {
        params: {
          arguments: {
            prompt: 'style ref',
            reference_images: ['https://example.com/a.png', '/etc/shadow.png'],
          },
        },
      },
      api(),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UNSAFE_PATH);
    expect(submitVideoJob).not.toHaveBeenCalled();
  });

  it('accepts sandboxed local first_frame_image and submits frame_images', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await fs.writeFile(path.join(sandbox, 'start.png'), png);
    submitVideoJob.mockResolvedValue({ id: 'vid_1', status: 'pending' });

    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'vid_1',
      status: 'failed',
      error: { message: 'test short-circuit' },
    });
    const client = { submitVideoJob, pollVideoJob } as unknown as OpenRouterAPIClient;

    const r = await handleGenerateVideo(
      {
        params: {
          arguments: {
            prompt: 'animate',
            first_frame_image: 'start.png',
          },
        },
      },
      client,
    );

    expect(submitVideoJob).toHaveBeenCalledTimes(1);
    const body = submitVideoJob.mock.calls[0]![0] as Record<string, unknown>;
    const frames = body.frame_images as Array<Record<string, unknown>>;
    expect(Array.isArray(frames)).toBe(true);
    expect(frames[0]).toMatchObject({
      type: 'image_url',
      frame_type: 'first_frame',
    });
    expect(String((frames[0]!.image_url as { url: string }).url)).toMatch(
      /^data:image\/png;base64,/,
    );
    // Job fails at poll (mock) — we only assert submit body shape here.
    expect(r.isError).toBe(true);
  });
});
