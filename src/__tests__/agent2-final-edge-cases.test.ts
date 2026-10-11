/**
 * Agent 2 — Final edge-case coverage for embed_text, decide,
 * classifyUpstreamError, handleGenerateVideoFromImage, and handleGetVideoStatus.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets (identified by exhaustive diff of all source branches vs every
 * existing test file in the repo):
 *
 * handleGenerateVideoFromImage (generate-video.ts):
 *  1. image: null → INVALID_INPUT
 *  2. image: 42 (number) → INVALID_INPUT
 *  3. image: undefined → INVALID_INPUT
 *  4. prompt: null → INVALID_INPUT
 *  5. prompt: 42 (number) → INVALID_INPUT
 *  6. prompt: undefined → INVALID_INPUT
 *  7. Missing arguments (undefined) → INVALID_INPUT
 *
 * handleGetVideoStatus — isValidVideoId edge cases:
 *  8. video_id with null byte \0 → INVALID_INPUT
 *  9. video_id with backslash → INVALID_INPUT
 *  10. video_id at exactly 256 chars (MAX_VIDEO_ID_LENGTH) → accepted
 *
 * classifyUpstreamError — extractRetryAfterSeconds edge cases:
 *  11. Retry-After: '0' (zero) on 429 → retry_after_seconds = 0
 *  12. Retry-After: negative integer '-1' on 429 → retry_after_seconds undefined
 *  13. Error with numeric err.code (429) → extractStatus picks it up
 *
 * handleEmbedText — remaining type edge cases:
 *  14. texts with object element {} → INVALID_INPUT (typeof !== 'string')
 *  15. dimensions: true (boolean) → INVALID_INPUT
 *  16. dimensions: -0 → INVALID_INPUT (positive integer check)
 *
 * handleDecide — API response edge cases:
 *  17. answers: null (not undefined, not empty object, not array) → INTERNAL
 *  18. score answer with single-element array [0.9] → works, reports level 1/1
 *  19. noul with string "undefined" → P=0 (typeof !== 'number')
 *  20. Mixed answer types: some valid, some have unrecognized type → only valid appear
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleGenerateVideoFromImage,
  handleGetVideoStatus,
} from '../tool-handlers/generate-video.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { classifyUpstreamError } from '../tool-handlers/openrouter-errors.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: {
    code: string;
    details?: Record<string, unknown>;
    suggestions?: string[];
    retry_after_seconds?: number;
  };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

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
// 1–7. handleGenerateVideoFromImage — non-string image/prompt types
// ---------------------------------------------------------------------------

describe('handleGenerateVideoFromImage — image type validation', () => {
  it('returns INVALID_INPUT when image is null', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await handleGenerateVideoFromImage(
      {
        params: {
          arguments: { image: null as unknown as string, prompt: 'a cat' },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('image is required');
  });

  it('returns INVALID_INPUT when image is a number', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await handleGenerateVideoFromImage(
      {
        params: {
          arguments: { image: 42 as unknown as string, prompt: 'a cat' },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('image is required');
  });

  it('returns INVALID_INPUT when image is undefined', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await handleGenerateVideoFromImage(
      {
        params: {
          arguments: { image: undefined as unknown as string, prompt: 'a cat' },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('image is required');
  });

  it('returns INVALID_INPUT when image is whitespace-only', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await handleGenerateVideoFromImage(
      {
        params: {
          arguments: { image: '   ', prompt: 'a cat' },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('image is required');
  });
});

describe('handleGenerateVideoFromImage — prompt type validation', () => {
  it('returns INVALID_INPUT when prompt is null', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await handleGenerateVideoFromImage(
      {
        params: {
          arguments: { image: 'https://example.com/img.png', prompt: null as unknown as string },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('prompt is required');
  });

  it('returns INVALID_INPUT when prompt is a number', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await handleGenerateVideoFromImage(
      {
        params: {
          arguments: { image: 'https://example.com/img.png', prompt: 42 as unknown as string },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('prompt is required');
  });

  it('returns INVALID_INPUT when prompt is undefined', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await handleGenerateVideoFromImage(
      {
        params: {
          arguments: {
            image: 'https://example.com/img.png',
            prompt: undefined as unknown as string,
          },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('prompt is required');
  });

  it('returns INVALID_INPUT when prompt is whitespace-only', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await handleGenerateVideoFromImage(
      {
        params: {
          arguments: { image: 'https://example.com/img.png', prompt: '   \t  ' },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('prompt is required');
  });
});

describe('handleGenerateVideoFromImage — missing arguments', () => {
  it('returns INVALID_INPUT when arguments is undefined', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await handleGenerateVideoFromImage(
      {
        params: {
          arguments: undefined as unknown as { image: string; prompt: string },
        },
      },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// 8–10. handleGetVideoStatus — isValidVideoId edge cases
// ---------------------------------------------------------------------------

describe('handleGetVideoStatus — video_id with null byte', () => {
  it('rejects video_id containing null byte \\0', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await handleGetVideoStatus(
      { params: { arguments: { video_id: 'vid\x00123' } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('Invalid video_id');
  });
});

describe('handleGetVideoStatus — video_id with backslash', () => {
  it('rejects video_id containing backslash', async () => {
    const client = {} as unknown as OpenRouterAPIClient;
    const r = await handleGetVideoStatus(
      { params: { arguments: { video_id: 'vid\\123' } } },
      client,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('Invalid video_id');
  });
});

describe('handleGetVideoStatus — video_id at exactly MAX_VIDEO_ID_LENGTH', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '/tmp');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('accepts video_id at exactly 256 characters', async () => {
    const longId = 'v'.repeat(256);
    expect(longId.length).toBe(256);
    const pollVideoJob = vi.fn().mockResolvedValue({
      id: longId,
      status: 'running',
      progress: 50,
    });
    const client = { pollVideoJob } as unknown as OpenRouterAPIClient;
    const r = await handleGetVideoStatus({ params: { arguments: { video_id: longId } } }, client);
    // Should pass validation and reach the API call
    expect(pollVideoJob).toHaveBeenCalledWith(longId);
    // Status is 'running' so it returns JOB_STILL_RUNNING
    expect((r as { _meta: { code: string } })._meta.code).toBe('JOB_STILL_RUNNING');
  });
});

// ---------------------------------------------------------------------------
// 11–13. classifyUpstreamError — Retry-After edge cases
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — Retry-After zero value', () => {
  it('returns retry_after_seconds: 0 when Retry-After is "0"', () => {
    const err = {
      status: 429,
      message: 'rate limit exceeded',
      headers: { 'retry-after': '0' },
    };
    const r = classifyUpstreamError(err) as ErrorResult;
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.retry_after_seconds).toBe(0);
  });
});

describe('classifyUpstreamError — Retry-After negative integer', () => {
  it('returns 0 when Retry-After is "-1" (Date.parse interprets as past date)', () => {
    const err = {
      status: 429,
      message: 'rate limit exceeded',
      headers: { 'retry-after': '-1' },
    };
    const r = classifyUpstreamError(err) as ErrorResult;
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    // parseInt('-1') = -1, isFinite(-1) && -1 >= 0 → false
    // Date.parse('-1') → valid Date (year -1), far in the past → deltaSec < 0 → returns 0
    expect(r._meta.retry_after_seconds).toBe(0);
  });
});

describe('classifyUpstreamError — err.code as number (not string)', () => {
  it('extracts status from numeric err.code 429', () => {
    const err = { code: 429, message: 'rate limited' };
    const r = classifyUpstreamError(err) as ErrorResult;
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toMatchObject({ status: 429 });
  });

  it('extracts status from numeric err.code 500', () => {
    const err = { code: 500, message: 'internal server error' };
    const r = classifyUpstreamError(err) as ErrorResult;
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toMatchObject({ status: 500 });
  });

  it('extracts status from numeric err.code 413', () => {
    const err = { code: 413, message: 'payload too large' };
    const r = classifyUpstreamError(err) as ErrorResult;
    expect(r._meta.code).toBe('RESOURCE_TOO_LARGE');
    expect(r._meta.details).toMatchObject({ status: 413 });
  });
});

// ---------------------------------------------------------------------------
// 14–16. handleEmbedText — remaining type edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — texts with object element', () => {
  it('returns INVALID_INPUT when a text element is an object', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: ['valid', { nested: true }] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('returns INVALID_INPUT when a text element is an array', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [['nested', 'array'], 'valid'] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('must be a string');
  });
});

describe('handleEmbedText — dimensions: true (boolean)', () => {
  it('returns INVALID_INPUT for boolean dimensions', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: true }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('positive integer');
  });
});

describe('handleEmbedText — dimensions: -0 edge case', () => {
  it('returns INVALID_INPUT for -0 dimensions (-0 < 1 → positive integer check)', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: -0 }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    // -0 is a valid number, is finite, is integer, but -0 < 1 is true → fails >= 1 check
    expect(r.content[0].text).toContain('positive integer');
  });
});

// ---------------------------------------------------------------------------
// 17–20. handleDecide — API response edge cases
// ---------------------------------------------------------------------------

describe('handleDecide — answers is null from API', () => {
  it('returns INTERNAL when answers is null', async () => {
    const client = mockDecideClient({ answers: null });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No answers returned');
  });
});

describe('handleDecide — score answer with single element', () => {
  it('handles score answer with one-element array correctly', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.9] } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 'score', instructions: 'rate', criteria: ['bad', 'good'] },
        },
      }),
      client,
    )) as SuccessResult;
    // score has length 1, first (and only) value is 0.9 → level 1/1
    expect(r.content[0].text).toContain('level 1/1');
    expect(r.content[0].text).toContain('90.0%');
  });
});

describe('handleDecide — noul with string "undefined"', () => {
  it('treats noul="undefined" (typeof string !== number) as P=0 → NO', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 'undefined' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    // typeof 'undefined' !== 'number' → prob defaults to 0
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

describe('handleDecide — mixed answer types with some unrecognized', () => {
  it('renders valid answers and skips unrecognized types', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.8 },
        q2: { type: 'custom_type', data: {} }, // unrecognized
        q3: { type: 'score', score: [0.1, 0.9] },
        q4: { type: 'choice', choice: { a: 0.7, b: 0.3 } },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: { type: 'noul', instructions: 'test2', criteria: { yes: 'y', no: 'n' } },
          q3: { type: 'score', instructions: 'rate', criteria: ['low', 'high'] },
          q4: { type: 'choice', instructions: 'pick', criteria: { a: 'A', b: 'B' } },
        },
      }),
      client,
    )) as SuccessResult;
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    // q2 has unrecognized type 'custom_type' → skipped
    // q1, q3, q4 should appear
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('q1');
    expect(lines[0]).toContain('YES');
    expect(lines[1]).toContain('q3');
    expect(lines[1]).toContain('level 2/2');
    expect(lines[2]).toContain('q4');
    expect(lines[2]).toContain('a');
    expect(lines[2]).toContain('70.0%');
  });
});

// ---------------------------------------------------------------------------
// Additional: classifyUpstreamError — "request blocked" without "blocked:" prefix
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — "request blocked" guardrail variant', () => {
  it('maps "request blocked" (without colon) to UPSTREAM_REFUSED policy', () => {
    const err = new Error('request blocked by safety system');
    const r = classifyUpstreamError(err) as ErrorResult;
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toMatchObject({ reason: 'policy' });
  });
});

// ---------------------------------------------------------------------------
// Additional: classifyUpstreamError — extractStatus from HTTP regex in message
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — extractStatus from HTTP regex in Error message', () => {
  it('extracts HTTP 503 from error message text', () => {
    const err = new Error('POST /chat/completions failed: HTTP 503');
    const r = classifyUpstreamError(err) as ErrorResult;
    // 503 >= 500 → UPSTREAM_HTTP
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toMatchObject({ status: 503 });
  });

  it('extracts HTTP 408 from error message and maps to UPSTREAM_TIMEOUT', () => {
    const err = new Error('Request timed out HTTP 408');
    const r = classifyUpstreamError(err) as ErrorResult;
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
    expect(r._meta.details).toMatchObject({ status: 408 });
  });
});

// ---------------------------------------------------------------------------
// Additional: classifyUpstreamError — isAuthFailure with 403 + authentication
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — 403 with authentication keyword', () => {
  it('maps 403 + "authentication" to INVALID_CREDENTIALS', () => {
    const err = Object.assign(new Error('Failed authentication check'), { status: 403 });
    const r = classifyUpstreamError(err) as ErrorResult;
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
    expect(r._meta.details).toMatchObject({ status: 403, reason: 'auth' });
  });

  it('maps 403 + "invalid credentials" to INVALID_CREDENTIALS', () => {
    const err = Object.assign(new Error('Invalid credentials for this endpoint'), { status: 403 });
    const r = classifyUpstreamError(err) as ErrorResult;
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });
});

// ---------------------------------------------------------------------------
// Additional: embed_text — model as boolean type
// ---------------------------------------------------------------------------

describe('handleEmbedText — model as boolean', () => {
  it('returns INVALID_INPUT when model is a boolean true', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: true }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT when model is a boolean false', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: false }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty string');
  });
});

// ---------------------------------------------------------------------------
// Additional: decide — model as boolean type
// ---------------------------------------------------------------------------

describe('handleDecide — model as boolean', () => {
  it('returns INVALID_INPUT when model is a boolean true', async () => {
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, model: true }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty string');
  });
});
