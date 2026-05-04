import { describe, it, expect, vi } from 'vitest';
import * as genVideo from '../tool-handlers/generate-video.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

describe('handleGenerateVideoFromImage', () => {
  it('returns INVALID_INPUT when image is missing', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await genVideo.handleGenerateVideoFromImage(
      {
        params: {
          arguments: { image: '', prompt: 'a cat' } as unknown as {
            image: string;
            prompt: string;
          },
        },
      },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when prompt is empty', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await genVideo.handleGenerateVideoFromImage(
      {
        params: {
          arguments: { image: 'https://example.com/a.png', prompt: '' } as unknown as {
            image: string;
            prompt: string;
          },
        },
      },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
  });

  it('delegates to handleGenerateVideo with first_frame_image set', async () => {
    // Use a data URL so prepareImageInput resolves synchronously without a
    // real HTTP fetch, then stub the OpenRouter API client to fail fast
    // on submit. This proves delegation happened and the request body was
    // assembled with `frame_images` populated from the `image` argument.
    const submitVideoJob = vi.fn().mockRejectedValue(new Error('HTTP 400 bad req'));
    const client = {
      submitVideoJob,
      pollVideoJob: vi.fn(),
      downloadVideoContent: vi.fn(),
    } as unknown as OpenRouterAPIClient;

    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVQIHWNgAAIAAAUAAYehTtQAAAAASUVORK5CYII=';

    await genVideo.handleGenerateVideoFromImage(
      {
        params: {
          arguments: {
            image: tinyPng,
            prompt: 'slow zoom in',
            duration: 4,
          },
        },
      },
      client,
    );

    // generate_video tries the upstream once even on prep errors if image resolve succeeds.
    // We at minimum verify submit was called, which proves delegation happened.
    expect(submitVideoJob).toHaveBeenCalled();
    const body = (submitVideoJob.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.prompt).toBe('slow zoom in');
    expect(body.duration).toBe(4);
    // `first_frame_image` becomes `frame_images[0]` after prepareImageInput runs.
    expect(Array.isArray(body.frame_images)).toBe(true);
  });
});
