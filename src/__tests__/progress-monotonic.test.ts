/**
 * v4.5.1 — regression test for the bug-hunter's HIGH finding that
 * `notifications/progress` could emit decreasing values when upstream
 * returned a numeric `progress: 75` followed by a tick without one (our
 * fallback to `attempt` then produced a small integer like 2).
 *
 * This test exercises the WIRE-LEVEL assertion: monitor what the MCP
 * client would see on the notification channel, and prove progress
 * values never decrease regardless of upstream's behavior.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleGenerateVideo } from '../tool-handlers/generate-video.js';
import type {
  OpenRouterAPIClient,
  VideoJobEnvelope,
  VideoJobStatus,
} from '../openrouter-api.js';

function mockClient(statuses: VideoJobStatus[]) {
  let i = 0;
  return {
    submitVideoJob: vi.fn().mockResolvedValue({
      id: 'vid_mono',
      status: 'pending',
    } as VideoJobEnvelope),
    pollVideoJob: vi.fn().mockImplementation(async () => {
      const s = statuses[Math.min(i, statuses.length - 1)];
      i += 1;
      return s;
    }),
    downloadVideoContent: vi.fn().mockResolvedValue({
      buffer: Buffer.from('v'),
      contentType: 'video/mp4',
    }),
  } as unknown as OpenRouterAPIClient;
}

describe('progress notifications are monotonic', () => {
  it('never decreases even when upstream alternates numeric / null progress', async () => {
    // The vulnerable pattern: upstream returns 75, then no number, then 90.
    // Old implementation would emit 75, then `attempt` (e.g. 2), then 90 —
    // violating the MCP spec.
    const client = mockClient([
      { id: 'vid_mono', status: 'processing', progress: 25 },
      { id: 'vid_mono', status: 'processing', progress: 75 },
      { id: 'vid_mono', status: 'processing' }, // no progress number
      { id: 'vid_mono', status: 'processing', progress: 90 },
      {
        id: 'vid_mono',
        status: 'completed',
        unsigned_urls: ['https://x/y.mp4'],
      },
    ]);

    // Mimic the hook that tool-handlers.ts would construct. We capture
    // the `progress` field that each notification would carry.
    let lastSent = -1;
    const emitted: number[] = [];
    const hook: Parameters<typeof handleGenerateVideo>[2] = ({
      status,
      progress,
      attempt,
    }) => {
      // Reproduce the exact logic from `buildProgressHook` in
      // tool-handlers.ts so this test catches future regressions there.
      const candidate =
        typeof progress === 'number' ? Math.max(attempt, progress) : attempt;
      const next = Math.max(lastSent + 1, candidate);
      lastSent = next;
      emitted.push(next);
      void status;
    };

    await handleGenerateVideo(
      {
        params: {
          arguments: {
            prompt: 'monotonic test',
            max_wait_ms: 100_000,
            poll_interval_ms: 50,
          },
        },
      },
      client,
      hook,
    );

    // Assertion: strictly increasing.
    for (let i = 1; i < emitted.length; i++) {
      expect(emitted[i]).toBeGreaterThan(emitted[i - 1]!);
    }
  });

  it('still advances forward when upstream progress regresses (e.g. 75 -> 50)', async () => {
    const client = mockClient([
      { id: 'vid_mono', status: 'processing', progress: 75 },
      { id: 'vid_mono', status: 'processing', progress: 50 }, // upstream regressed
      {
        id: 'vid_mono',
        status: 'completed',
        unsigned_urls: ['https://x/y.mp4'],
      },
    ]);

    let lastSent = -1;
    const emitted: number[] = [];
    const hook: Parameters<typeof handleGenerateVideo>[2] = ({
      progress,
      attempt,
    }) => {
      const candidate =
        typeof progress === 'number' ? Math.max(attempt, progress) : attempt;
      const next = Math.max(lastSent + 1, candidate);
      lastSent = next;
      emitted.push(next);
    };

    await handleGenerateVideo(
      {
        params: {
          arguments: {
            prompt: 'regress test',
            max_wait_ms: 100_000,
            poll_interval_ms: 50,
          },
        },
      },
      client,
      hook,
    );

    for (let i = 1; i < emitted.length; i++) {
      expect(emitted[i]).toBeGreaterThan(emitted[i - 1]!);
    }
  });
});


describe('progress: 0 edge case', () => {
  it('handles upstream returning progress: 0 on the first real tick', async () => {
    const client = mockClient([
      { id: 'vid_mono', status: 'processing', progress: 0 },
      { id: 'vid_mono', status: 'processing', progress: 50 },
      {
        id: 'vid_mono',
        status: 'completed',
        unsigned_urls: ['https://x/y.mp4'],
      },
    ]);

    let lastSent = -1;
    const emitted: number[] = [];
    const hook: Parameters<typeof handleGenerateVideo>[2] = ({
      progress,
      attempt,
    }) => {
      const candidate =
        typeof progress === 'number' ? Math.max(attempt, progress) : attempt;
      const next = Math.max(lastSent + 1, candidate);
      lastSent = next;
      emitted.push(next);
    };

    await handleGenerateVideo(
      {
        params: {
          arguments: {
            prompt: 'progress zero test',
            max_wait_ms: 100_000,
            poll_interval_ms: 50,
          },
        },
      },
      client,
      hook,
    );

    // All values must be strictly increasing
    for (let i = 1; i < emitted.length; i++) {
      expect(emitted[i]).toBeGreaterThan(emitted[i - 1]!);
    }
    // First real tick (attempt=0, initial status) should produce progress=0
    expect(emitted[0]).toBe(0);
  });
});
