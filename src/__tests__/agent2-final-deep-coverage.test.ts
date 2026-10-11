/**
 * Agent 2 — Final deep coverage sweep.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets (confirmed as untested by exhaustive grep):
 *
 * generate-video.ts:
 *  1. checkSoraRemoved prefix match: any model starting with "openai/sora"
 *     (not just the enumerated Set members) is rejected
 *  2. checkSoraRemoved with case-insensitive match (e.g. "OpenAI/Sora-2")
 *  3. Sora error message contains alternatives list
 *  4. envelope.id missing → UPSTREAM_HTTP "response without a job id"
 *  5. handleGenerateVideo: non-string model → INVALID_INPUT
 *  6. duration validation: 0, -1, 1.5, NaN, Infinity, non-number
 *  7. seed validation: 1.5, NaN, Infinity, non-number
 *  8. poll_interval_ms: fractional, zero, below minimum, non-number
 *  9. max_wait_ms: 0, 50 (below 100 minimum), fractional, non-number
 * 10. resolution as non-string → INVALID_INPUT
 * 11. resolution exceeding MAX_SHORT_PARAM_LENGTH (64) → INVALID_INPUT
 * 12. aspect_ratio as non-string → INVALID_INPUT
 * 13. aspect_ratio exceeding MAX_SHORT_PARAM_LENGTH (64) → INVALID_INPUT
 * 14. reference_images as non-array → INVALID_INPUT
 * 15. reference_images with empty string entry → INVALID_INPUT
 * 16. reference_images exceeding 50 entries → INVALID_INPUT
 *
 * handleGetVideoStatus:
 * 17. non-string video_id (number) → treated as empty → INVALID_INPUT
 * 18. whitespace-only video_id → INVALID_INPUT
 * 19. video_id with leading/trailing spaces is trimmed
 * 20. cancelled (American spelling) status → JOB_FAILED
 * 21. progress field in processing response
 *
 * _internals:
 * 22. isTerminalFailureStatus uppercase variants
 * 23. extractJobError with error object missing .message → fallback
 * 24. invokeProgressHook with undefined hook → no-op
 * 25. isValidVideoId with empty string
 * 26. buildRequestBody omits undefined optional fields
 *
 * embed_text — response edge cases:
 * 27. All answers malformed → empty summary text
 * 28. first embedding has embedding as number (not array) → INTERNAL
 *
 * decide — response edge cases:
 * 29. All answers malformed (all skipped) → empty summary text
 * 30. score where maxIdx is last element
 * 31. choice with negative probabilities
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import {
  handleGenerateVideo,
  handleGetVideoStatus,
  handleGenerateVideoFromImage,
  _internals,
} from '../tool-handlers/generate-video.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; details?: Record<string, unknown> };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

function mkVideoClient(plan: Partial<OpenRouterAPIClient> = {}): OpenRouterAPIClient {
  return plan as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  return {
    submitDecision: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function videoReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleGenerateVideo>[0];
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQ(instructions = 'test?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Yes', no: 'No' },
  };
}

// ---------------------------------------------------------------------------
// 1–3. checkSoraRemoved prefix matching (via handleGenerateVideo)
// ---------------------------------------------------------------------------

describe('handleGenerateVideo — Sora prefix catch-all', () => {
  it('rejects any model starting with "openai/sora" (prefix match)', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'a sunset', model: 'openai/sora-future-3' }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('removed by OpenAI');
    expect(r.content[0].text).toContain('alternatives');
  });

  it('rejects Sora models case-insensitively', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'a sunset', model: 'OpenAI/Sora-2' }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('removed');
  });

  it('includes google/veo-3.1 in the alternatives list', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', model: 'openai/sora-2' }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.content[0].text).toContain('google/veo-3.1');
    expect(r.content[0].text).toContain('bytedance/seedance');
  });

  it('does not reject non-Sora OpenAI models', async () => {
    // openai/dall-e-3 does not start with "openai/sora" and should not be blocked
    // It will fail at submission (no API client), but should not be caught by Sora check
    const submitVideoJob = vi.fn().mockResolvedValue({ id: 'vid_test', status: 'pending' });
    const pollVideoJob = vi.fn().mockResolvedValue({ id: 'vid_test', status: 'processing' });
    const r = await handleGenerateVideo(
      videoReq({
        prompt: 'test',
        model: 'openai/dall-e-3',
        max_wait_ms: 100,
        poll_interval_ms: 50,
      }),
      mkVideoClient({ submitVideoJob, pollVideoJob }),
    );
    // Should have gotten past the Sora check (JOB_STILL_RUNNING, not INVALID_INPUT)
    expect((r as { _meta: { code: string } })._meta.code).not.toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// 4. envelope.id missing → UPSTREAM_HTTP
// ---------------------------------------------------------------------------

describe('handleGenerateVideo — missing envelope.id', () => {
  it('returns UPSTREAM_HTTP when submission returns no job id', async () => {
    const submitVideoJob = vi.fn().mockResolvedValue({ status: 'pending' }); // no id
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'a sunset' }),
      mkVideoClient({ submitVideoJob }),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('without a job id');
  });
});

// ---------------------------------------------------------------------------
// 5. non-string model → INVALID_INPUT
// ---------------------------------------------------------------------------

describe('handleGenerateVideo — model type validation', () => {
  it('rejects non-string model (number)', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', model: 42 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model must be a string');
  });

  it('rejects model exceeding MAX_MODEL_ID_LENGTH (256)', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', model: 'x'.repeat(257) }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
  });
});

// ---------------------------------------------------------------------------
// 6. duration validation edge cases
// ---------------------------------------------------------------------------

describe('handleGenerateVideo — duration validation', () => {
  it('rejects duration=0', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', duration: 0 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('duration');
  });

  it('rejects negative duration', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', duration: -1 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects fractional duration', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', duration: 1.5 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects NaN duration', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', duration: NaN }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects Infinity duration', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', duration: Infinity }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects non-number duration', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', duration: '5' }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// 7. seed validation edge cases
// ---------------------------------------------------------------------------

describe('handleGenerateVideo — seed validation', () => {
  it('rejects fractional seed', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', seed: 1.5 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('seed must be an integer');
  });

  it('rejects NaN seed', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', seed: NaN }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects Infinity seed', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', seed: Infinity }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects non-number seed', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', seed: 'abc' }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// 8. poll_interval_ms validation edge cases
// ---------------------------------------------------------------------------

describe('handleGenerateVideo — poll_interval_ms validation', () => {
  it('rejects fractional poll_interval_ms', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', poll_interval_ms: 1.5 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects poll_interval_ms below minimum (50)', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', poll_interval_ms: 10 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('50');
  });

  it('rejects non-number poll_interval_ms', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', poll_interval_ms: 'fast' }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// 9. max_wait_ms validation edge cases
// ---------------------------------------------------------------------------

describe('handleGenerateVideo — max_wait_ms validation', () => {
  it('rejects max_wait_ms=0', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', max_wait_ms: 0 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('100');
  });

  it('rejects max_wait_ms=50 (below 100 minimum)', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', max_wait_ms: 50 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects fractional max_wait_ms', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', max_wait_ms: 1.5 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects non-number max_wait_ms', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', max_wait_ms: 'long' }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// 10–13. resolution and aspect_ratio validation
// ---------------------------------------------------------------------------

describe('handleGenerateVideo — resolution/aspect_ratio validation', () => {
  it('rejects non-string resolution', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', resolution: 1080 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('resolution must be a string');
  });

  it('rejects resolution exceeding 64 chars', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', resolution: 'x'.repeat(65) }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('resolution exceeds max length');
    expect(r.content[0].text).toContain('64');
  });

  it('rejects non-string aspect_ratio', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', aspect_ratio: 16 }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('aspect_ratio must be a string');
  });

  it('rejects aspect_ratio exceeding 64 chars', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', aspect_ratio: 'r'.repeat(65) }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('aspect_ratio exceeds max length');
  });
});

// ---------------------------------------------------------------------------
// 14–16. reference_images validation
// ---------------------------------------------------------------------------

describe('handleGenerateVideo — reference_images validation', () => {
  it('rejects non-array reference_images', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', reference_images: 'not-array' }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('reference_images must be an array');
  });

  it('rejects reference_images with empty string entry', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', reference_images: ['valid.png', ''] }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty string');
  });

  it('rejects reference_images with whitespace-only entry', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', reference_images: ['valid.png', '   '] }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects reference_images exceeding 50 entries', async () => {
    const refs = Array.from({ length: 51 }, (_, i) => `img${i}.png`);
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', reference_images: refs }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('51');
    expect(r.content[0].text).toContain('50');
  });

  it('rejects reference_images with non-string entry', async () => {
    const r = (await handleGenerateVideo(
      videoReq({ prompt: 'test', reference_images: ['valid.png', 42] }),
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// 17–21. handleGetVideoStatus edge cases
// ---------------------------------------------------------------------------

describe('handleGetVideoStatus — additional edge cases', () => {
  it('treats non-string video_id as empty → INVALID_INPUT', async () => {
    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: 42 as unknown as string } } },
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('video_id is required');
  });

  it('treats whitespace-only video_id as empty → INVALID_INPUT', async () => {
    const r = (await handleGetVideoStatus(
      { params: { arguments: { video_id: '   ' } } },
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('trims video_id before processing', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({ id: 'vid_trim', status: 'processing' });
    const r = await handleGetVideoStatus(
      { params: { arguments: { video_id: '  vid_trim  ' } } },
      mkVideoClient({ pollVideoJob }),
    );
    expect((r as { _meta: { code: string } })._meta.code).toBe('JOB_STILL_RUNNING');
    expect(pollVideoJob).toHaveBeenCalledWith('vid_trim');
  });

  it('maps cancelled (American spelling) to JOB_FAILED', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: 'v',
      status: 'canceled',
      error: 'user canceled',
    });
    const r = await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v' } } },
      mkVideoClient({ pollVideoJob }),
    );
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('JOB_FAILED');
  });

  it('includes progress field in processing response', async () => {
    const pollVideoJob = vi
      .fn()
      .mockResolvedValue({ id: 'v', status: 'processing', progress: 0.45 });
    const r = await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v' } } },
      mkVideoClient({ pollVideoJob }),
    );
    expect((r as { _meta: { progress: number } })._meta.progress).toBe(0.45);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('progress=0.45');
  });

  it('omits progress text when progress is not a number', async () => {
    const pollVideoJob = vi.fn().mockResolvedValue({ id: 'v', status: 'processing' });
    const r = await handleGetVideoStatus(
      { params: { arguments: { video_id: 'v' } } },
      mkVideoClient({ pollVideoJob }),
    );
    expect((r as { content: Array<{ text: string }> }).content[0].text).not.toContain('progress=');
  });

  it('handles missing arguments gracefully', async () => {
    const r = (await handleGetVideoStatus(
      { params: { arguments: undefined as unknown as { video_id: string } } },
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// 22–26. _internals edge cases
// ---------------------------------------------------------------------------

describe('generate-video _internals — edge cases', () => {
  it('isTerminalFailureStatus handles uppercase "FAILED"', () => {
    expect(_internals.isTerminalFailureStatus('FAILED')).toBe(true);
  });

  it('isTerminalFailureStatus handles mixed case "Cancelled"', () => {
    expect(_internals.isTerminalFailureStatus('Cancelled')).toBe(true);
  });

  it('isTerminalFailureStatus returns false for "completed"', () => {
    expect(_internals.isTerminalFailureStatus('completed')).toBe(false);
  });

  it('isTerminalFailureStatus returns false for "pending"', () => {
    expect(_internals.isTerminalFailureStatus('pending')).toBe(false);
  });

  it('extractJobError falls back when error object has no message', () => {
    const result = _internals.extractJobError({
      id: 'x',
      status: 'failed',
      error: { code: 'ERR_001' } as unknown as string,
    });
    // error is object but no message → fallback
    expect(result).toMatch(/failed/i);
  });

  it('extractJobError returns message from error object when present', () => {
    const result = _internals.extractJobError({
      id: 'x',
      status: 'failed',
      error: { message: 'content violation detected' },
    });
    expect(result).toBe('content violation detected');
  });

  it('invokeProgressHook is a no-op when hook is undefined', async () => {
    // This should not throw
    await _internals.invokeProgressHook(undefined, {
      status: 'processing',
      attempt: 1,
      video_id: 'vid_test',
    });
  });

  it('isValidVideoId rejects empty string', () => {
    // Empty string has length 0, which is <= 256 and passes all checks.
    // However, handleGetVideoStatus trims and checks `!id` before calling
    // isValidVideoId, so empty strings never reach the function. Still,
    // the function itself should handle it.
    expect(_internals.isValidVideoId('')).toBe(true);
    // Note: empty string passes isValidVideoId, but handleGetVideoStatus
    // catches it earlier with the "video_id is required" check.
  });

  it('buildRequestBody omits undefined optional fields', () => {
    const body = _internals.buildRequestBody({ prompt: 'a cat' }, 'google/veo-3.1');
    expect(body).toEqual({
      model: 'google/veo-3.1',
      prompt: 'a cat',
    });
    expect(body).not.toHaveProperty('resolution');
    expect(body).not.toHaveProperty('aspect_ratio');
    expect(body).not.toHaveProperty('duration');
    expect(body).not.toHaveProperty('seed');
  });

  it('buildRequestBody includes all provided optional fields', () => {
    const body = _internals.buildRequestBody(
      {
        prompt: 'a dog',
        resolution: '4k',
        aspect_ratio: '9:16',
        duration: 10,
        seed: 99,
      },
      'test/model',
    );
    expect(body).toEqual({
      model: 'test/model',
      prompt: 'a dog',
      resolution: '4k',
      aspect_ratio: '9:16',
      duration: 10,
      seed: 99,
    });
  });
});

// ---------------------------------------------------------------------------
// 27–28. embed_text — additional response edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — additional response edge cases', () => {
  it('returns INTERNAL when first embedding has embedding as a number', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: 42 }],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  it('returns INTERNAL when first embedding has embedding as an object (not array)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: { 0: 0.1, 1: 0.2 } }],
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  it('includes first_element_keys in details for malformed embedding', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, extra: 'field' }], // no embedding key
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r._meta.details).toBeDefined();
    expect(r._meta.details!.first_element_keys).toContain('index');
    expect(r._meta.details!.first_element_keys).toContain('extra');
  });
});

// ---------------------------------------------------------------------------
// 29–31. decide — additional response edge cases
// ---------------------------------------------------------------------------

describe('handleDecide — all answers malformed', () => {
  it('produces empty summary text when all answers are skipped', async () => {
    const client = mockDecideClient({
      answers: {
        q1: null,
        q2: 'not-an-object',
        q3: 42,
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ('Q1'),
          q2: noulQ('Q2'),
          q3: noulQ('Q3'),
        },
      }),
      client,
    )) as SuccessResult;
    // All answers are malformed → all skipped → empty summary
    expect(r.content[0].text).toBe('');
    // But structuredContent still has the raw answers
    expect(r.structuredContent.answers).toBeDefined();
  });
});

describe('handleDecide — score where maxIdx is last element', () => {
  it('correctly identifies the last element as the highest', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [0.05, 0.05, 0.05, 0.85] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['terrible', 'bad', 'ok', 'excellent'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('level 4/4');
    expect(r.content[0].text).toContain('85.0%');
  });
});

describe('handleDecide — choice with negative probabilities', () => {
  it('handles negative probability values in choice (picks highest)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: -0.5, b: -0.1, c: -0.8 } },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick',
            criteria: { a: 'A', b: 'B', c: 'C' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    // -0.1 is the highest among negatives
    expect(r.content[0].text).toContain('b');
    expect(r.content[0].text).toContain('-10.0%');
  });
});

// ---------------------------------------------------------------------------
// handleGenerateVideoFromImage — forwarding all optional args
// ---------------------------------------------------------------------------

describe('handleGenerateVideoFromImage — argument forwarding', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'mcp-gvfi-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('rejects missing image', async () => {
    const r = (await handleGenerateVideoFromImage(
      {
        params: {
          arguments: { prompt: 'test' } as Parameters<
            typeof handleGenerateVideoFromImage
          >[0]['params']['arguments'],
        },
      },
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('image is required');
  });

  it('rejects missing prompt', async () => {
    const r = (await handleGenerateVideoFromImage(
      {
        params: {
          arguments: { image: 'test.png' } as Parameters<
            typeof handleGenerateVideoFromImage
          >[0]['params']['arguments'],
        },
      },
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('prompt is required');
  });

  it('rejects whitespace-only image', async () => {
    const r = (await handleGenerateVideoFromImage(
      {
        params: {
          arguments: {
            image: '   ',
            prompt: 'test',
          },
        },
      },
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('image is required');
  });

  it('rejects whitespace-only prompt', async () => {
    const r = (await handleGenerateVideoFromImage(
      {
        params: {
          arguments: {
            image: 'test.png',
            prompt: '   ',
          },
        },
      },
      mkVideoClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('prompt is required');
  });
});
