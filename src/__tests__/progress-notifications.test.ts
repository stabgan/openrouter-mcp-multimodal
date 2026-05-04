import { describe, it, expect, vi } from 'vitest';
import { handleGenerateVideo } from '../tool-handlers/generate-video.js';
import type {
  OpenRouterAPIClient,
  VideoJobEnvelope,
  VideoJobStatus,
} from '../openrouter-api.js';

function mockClient(envelope: VideoJobEnvelope, statuses: VideoJobStatus[]) {
  let idx = 0;
  const pollVideoJob = vi.fn().mockImplementation(async () => {
    const s = statuses[Math.min(idx, statuses.length - 1)];
    idx++;
    return s;
  });
  return {
    submitVideoJob: vi.fn().mockResolvedValue(envelope),
    pollVideoJob,
    downloadVideoContent: vi.fn().mockResolvedValue({
      buffer: Buffer.from('video'),
      contentType: 'video/mp4',
    }),
  } as unknown as OpenRouterAPIClient;
}

describe('generate_video progress hook', () => {
  it('invokes progress hook on each poll with status + attempt', async () => {
    const client = mockClient(
      { id: 'vid_1', status: 'pending' },
      [
        { id: 'vid_1', status: 'processing', progress: 25 },
        { id: 'vid_1', status: 'processing', progress: 75 },
        {
          id: 'vid_1',
          status: 'completed',
          unsigned_urls: ['https://x/y.mp4'],
        },
      ],
    );

    const updates: Array<{ status: string; progress?: number; attempt: number }> = [];
    await handleGenerateVideo(
      {
        params: {
          arguments: {
            prompt: 'a short clip',
            max_wait_ms: 100_000,
            poll_interval_ms: 50,
          },
        },
      },
      client,
      (u) => {
        updates.push({ status: u.status, progress: u.progress, attempt: u.attempt });
      },
    );

    expect(updates.length).toBeGreaterThanOrEqual(4); // initial + 3 polls
    expect(updates[0].status).toBe('pending');
    expect(updates[0].attempt).toBe(0);
    // Last update should be the completed status
    const last = updates[updates.length - 1];
    expect(last.status).toBe('completed');
  });

  it('works without a progress hook', async () => {
    const client = mockClient(
      { id: 'vid_1', status: 'pending' },
      [
        {
          id: 'vid_1',
          status: 'completed',
          unsigned_urls: ['https://x/y.mp4'],
        },
      ],
    );
    const r = await handleGenerateVideo(
      {
        params: {
          arguments: {
            prompt: 'x',
            max_wait_ms: 100_000,
            poll_interval_ms: 50,
          },
        },
      },
      client,
      // no hook
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
  });
});
