import { describe, it, expect, vi } from 'vitest';
import { ProgressNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { buildProgressHook } from '../tool-handlers.js';

function mockServer() {
  const notifications: unknown[] = [];
  const server = {
    notification: vi.fn().mockImplementation(async (n: unknown) => {
      notifications.push(n);
    }),
  } as unknown as Server;
  return { server, notifications };
}

describe('buildProgressHook', () => {
  it('returns undefined without a progress token', () => {
    expect(buildProgressHook({} as Server, undefined)).toBeUndefined();
  });

  it('emits monotonic progress values that validate against the SDK schema', async () => {
    const { server, notifications } = mockServer();
    const hook = buildProgressHook(server, 'tok-1');
    expect(hook).toBeDefined();

    hook!({ status: 'processing', progress: 75, attempt: 2, video_id: 'vid_1' });
    hook!({ status: 'processing', attempt: 3, video_id: 'vid_1' });
    hook!({ status: 'processing', progress: 50, attempt: 4, video_id: 'vid_1' });

    await vi.waitFor(() => expect(notifications.length).toBe(3));

    const progressValues = notifications.map((n) => {
      const parsed = ProgressNotificationSchema.safeParse(n);
      expect(parsed.success).toBe(true);
      return parsed.data!.params.progress;
    });
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThan(progressValues[i - 1]!);
    }
  });

  it('swallows notification transport failures without throwing', async () => {
    const server = {
      notification: vi.fn().mockRejectedValue(new Error('transport closed')),
    } as unknown as Server;
    const hook = buildProgressHook(server, 42);
    expect(() =>
      hook!({ status: 'processing', progress: 10, attempt: 1, video_id: 'vid_1' }),
    ).not.toThrow();
    await vi.waitFor(() => expect(server.notification).toHaveBeenCalled());
  });
});
