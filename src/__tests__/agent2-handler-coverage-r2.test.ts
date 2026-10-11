/**
 * Agent 2 — Round 2: Test coverage for untested handler branches.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets (identified by diffing source code vs existing test files):
 *
 * generate-audio.ts:
 *  1. Non-string model type validation (model: 42)
 *  2. Non-string voice type validation (voice: true)
 *  3. RESOURCE_TOO_LARGE when streaming audio exceeds maxBytes
 *  4. Text-only fallback — model emits delta.content without delta.audio
 *  5. Missing/empty prompt validation
 *  6. Non-string prompt validation
 *
 * async-chat.ts:
 *  7. rememberJob returns false → INTERNAL error (too many concurrent jobs)
 *  8. Completed job without result data → INTERNAL guard
 *  9. Failed job with error_suggestions and retry_after_seconds in status response
 *  10. Invalid job_id format (path separators, no chat_ prefix)
 *  11. Non-string job_id type
 *  12. Missing arguments fallback for handleGetChatCompletionStatus
 *  13. Still-running job status response shape
 *
 * embed_text / decide — final edge case gaps:
 *  14. embed_text: non-string model type (boolean)
 *  15. decide: answers field is a non-null non-object non-array type (number)
 *  16. decide: noul=-0 edge case (0 >= 0.5 is false → NO)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGenerateAudio } from '../tool-handlers/generate-audio.js';
import {
  handleStartChatCompletion,
  handleGetChatCompletionStatus,
  resetAsyncJobStateForTests,
  type AsyncJob,
} from '../tool-handlers/async-chat.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { ErrorCode } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import type OpenAI from 'openai';
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
  structuredContent?: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

/**
 * Create a mock OpenAI client that streams the given audio chunks from
 * chat.completions.create. Each chunk is { data?, transcript?, content? }.
 */
function mockAudioStream(
  chunks: Array<{ data?: string; transcript?: string; content?: string }>,
  opts?: {
    finishReason?: string;
    usage?: Record<string, unknown>;
  },
): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(
          (async function* () {
            for (let i = 0; i < chunks.length; i++) {
              const isLast = i === chunks.length - 1;
              const chunk = chunks[i]!;
              const delta: Record<string, unknown> = {};
              if (chunk.data !== undefined || chunk.transcript !== undefined) {
                delta.audio = {
                  ...(chunk.data !== undefined ? { data: chunk.data } : {}),
                  ...(chunk.transcript !== undefined ? { transcript: chunk.transcript } : {}),
                };
              }
              if (chunk.content !== undefined) {
                delta.content = chunk.content;
              }
              yield {
                choices: [
                  {
                    delta,
                    finish_reason: isLast ? (opts?.finishReason ?? null) : null,
                  },
                ],
                ...(isLast && opts?.usage ? { usage: opts.usage } : {}),
              };
            }
            // Empty stream with metadata
            if (chunks.length === 0 && (opts?.finishReason || opts?.usage)) {
              yield {
                choices: [{ delta: {}, finish_reason: opts.finishReason ?? null }],
                ...(opts.usage ? { usage: opts.usage } : {}),
              };
            }
          })(),
        ),
      },
    },
  } as unknown as OpenAI;
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

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

// ---------------------------------------------------------------------------
// 1–2. generate-audio — model and voice type validation
// ---------------------------------------------------------------------------

describe('handleGenerateAudio — model/voice type validation', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '/tmp');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects non-string model (number)', async () => {
    const openai = mockAudioStream([]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'test', model: 42 as unknown as string } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0]?.text).toContain('model must be a string');
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('rejects non-string model (boolean)', async () => {
    const openai = mockAudioStream([]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'test', model: true as unknown as string } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0]?.text).toContain('model must be a string');
  });

  it('rejects non-string model (object)', async () => {
    const openai = mockAudioStream([]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'test', model: {} as unknown as string } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('rejects non-string voice (number)', async () => {
    const openai = mockAudioStream([]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'test', voice: 42 as unknown as string } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0]?.text).toContain('voice must be a string');
  });

  it('rejects non-string voice (boolean)', async () => {
    const openai = mockAudioStream([]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'test', voice: true as unknown as string } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0]?.text).toContain('voice must be a string');
  });

  it('accepts valid string model and voice', async () => {
    const pcm = Buffer.alloc(64, 0x11);
    const openai = mockAudioStream([{ data: pcm.toString('base64') }]);
    const r = await handleGenerateAudio(
      {
        params: {
          arguments: { prompt: 'test', model: 'openai/gpt-audio', voice: 'shimmer' },
        },
      },
      openai,
    );
    expect(r.isError).toBeUndefined();
    expect(openai.chat.completions.create).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. generate-audio — RESOURCE_TOO_LARGE streaming limit
// ---------------------------------------------------------------------------

describe('handleGenerateAudio — RESOURCE_TOO_LARGE streaming limit', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '/tmp');
    // readEnvInt has a minimum of 1024 for this env var
    vi.stubEnv('OPENROUTER_AUDIO_GEN_MAX_BYTES', '1024');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns RESOURCE_TOO_LARGE when audio stream exceeds maxBytes', async () => {
    // 1200 bytes raw audio → exceeds 1024 byte limit
    const largeChunk = Buffer.alloc(1200, 0xff).toString('base64');
    const openai = mockAudioStream([{ data: largeChunk }]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'generate a symphony' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.RESOURCE_TOO_LARGE);
    expect(r.content[0]?.text).toContain('Streaming audio exceeded');
    expect(r.content[0]?.text).toContain('OPENROUTER_AUDIO_GEN_MAX_BYTES');
  });
});

// ---------------------------------------------------------------------------
// 4. generate-audio — text-only fallback (delta.content without audio)
// ---------------------------------------------------------------------------

describe('handleGenerateAudio — text-only delta.content fallback', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '/tmp');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('surfaces delta.content in error when no audio chunks received', async () => {
    const openai = mockAudioStream([
      { content: 'I cannot generate audio because ' },
      { content: 'this model does not support it.' },
    ]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'generate audio' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.UNSUPPORTED_FORMAT);
    expect(r.content[0]?.text).toContain('text only');
    expect(r.content[0]?.text).toContain('I cannot generate audio');
  });

  it('prefers transcript over delta.content in error message', async () => {
    const openai = mockAudioStream([
      { transcript: 'The transcript text' },
      { content: 'The content text' },
    ]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'generate audio' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('transcript only');
    expect(r.content[0]?.text).toContain('The transcript text');
  });
});

// ---------------------------------------------------------------------------
// 5–6. generate-audio — prompt validation
// ---------------------------------------------------------------------------

describe('handleGenerateAudio — prompt validation', () => {
  it('rejects empty prompt', async () => {
    const openai = mockAudioStream([]);
    const r = await handleGenerateAudio({ params: { arguments: { prompt: '' } } }, openai);
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0]?.text).toContain('prompt is required');
  });

  it('rejects whitespace-only prompt', async () => {
    const openai = mockAudioStream([]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: '   \t\n   ' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('rejects non-string prompt', async () => {
    const openai = mockAudioStream([]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 42 as unknown as string } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('rejects null prompt', async () => {
    const openai = mockAudioStream([]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: null as unknown as string } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });
});

// ---------------------------------------------------------------------------
// 7. async-chat — rememberJob returns false (too many concurrent jobs)
// ---------------------------------------------------------------------------

describe('handleStartChatCompletion — too many concurrent jobs', () => {
  beforeEach(() => {
    resetAsyncJobStateForTests();
    vi.stubEnv('OPENROUTER_ASYNC_JOBS_MEMORY_MAX', '1');
  });
  afterEach(() => {
    resetAsyncJobStateForTests();
    vi.unstubAllEnvs();
  });

  it('returns INTERNAL when all job slots are occupied by running jobs', async () => {
    const neverResolve = new Promise(() => {});
    const openai = {
      chat: {
        completions: {
          create: vi.fn().mockReturnValue(neverResolve),
        },
      },
    } as unknown as OpenAI;

    // First job fills the only slot
    const r1 = await handleStartChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    expect(r1.isError).toBeUndefined();
    expect(r1._meta.status).toBe('running');

    // Second job fails — all slots occupied
    const r2 = await handleStartChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hello too' }] } } },
      openai,
    );
    expect(r2.isError).toBe(true);
    expect((r2 as ErrorResult)._meta.code).toBe(ErrorCode.INTERNAL);
    expect(r2.content[0]?.text).toContain('Too many concurrent async jobs');
    expect((r2 as ErrorResult)._meta.suggestions).toBeDefined();
    expect(
      (r2 as ErrorResult)._meta.suggestions!.some((s: string) =>
        s.includes('get_chat_completion_status'),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. async-chat — completed job without result data
// ---------------------------------------------------------------------------

describe('handleGetChatCompletionStatus — completed but no result', () => {
  let sandbox: string;

  beforeEach(async () => {
    resetAsyncJobStateForTests();
    const { promises: fsp } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const pathMod = await import('node:path');
    sandbox = await fsp.mkdtemp(pathMod.join(tmpdir(), 'async-chat-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
  });

  afterEach(async () => {
    resetAsyncJobStateForTests();
    vi.unstubAllEnvs();
    const { promises: fsp } = await import('node:fs');
    await fsp.rm(sandbox, { recursive: true, force: true });
  });

  it('returns INTERNAL when a persisted job has status=completed but no result', async () => {
    const pathMod = await import('node:path');
    const { promises: fsp } = await import('node:fs');

    const jobId = 'chat_20261011000000_001_deadbeef';
    const job: AsyncJob = {
      id: jobId,
      status: 'completed',
      createdAt: new Date().toISOString(),
      model: 'openai/gpt-4o',
    };
    const jobDir = pathMod.join(sandbox, 'openrouter-jobs', jobId);
    await fsp.mkdir(jobDir, { recursive: true });
    await fsp.writeFile(pathMod.join(jobDir, 'status.json'), JSON.stringify(job));

    const r = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: jobId } },
    });
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INTERNAL);
    expect(r.content[0]?.text).toContain('completed but result data is missing');
  });
});

// ---------------------------------------------------------------------------
// 9. async-chat — failed job with error_suggestions and retry_after_seconds
// ---------------------------------------------------------------------------

describe('handleGetChatCompletionStatus — failed job with suggestions', () => {
  let sandbox: string;

  beforeEach(async () => {
    resetAsyncJobStateForTests();
    const { promises: fsp } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const pathMod = await import('node:path');
    sandbox = await fsp.mkdtemp(pathMod.join(tmpdir(), 'async-chat-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
  });

  afterEach(async () => {
    resetAsyncJobStateForTests();
    vi.unstubAllEnvs();
    const { promises: fsp } = await import('node:fs');
    await fsp.rm(sandbox, { recursive: true, force: true });
  });

  it('includes error_suggestions and retry_after_seconds in failed job response', async () => {
    const pathMod = await import('node:path');
    const { promises: fsp } = await import('node:fs');

    const jobId = 'chat_20261011000001_001_abcd1234';
    const job: AsyncJob = {
      id: jobId,
      status: 'failed',
      createdAt: new Date().toISOString(),
      model: 'openai/gpt-4o',
      error: 'Rate limit exceeded',
      error_code: ErrorCode.UPSTREAM_REFUSED,
      error_suggestions: ['Wait 30 seconds before retrying', 'Try a different model'],
      retry_after_seconds: 30,
    };
    const jobDir = pathMod.join(sandbox, 'openrouter-jobs', jobId);
    await fsp.mkdir(jobDir, { recursive: true });
    await fsp.writeFile(pathMod.join(jobDir, 'status.json'), JSON.stringify(job));

    const r = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: jobId } },
    });
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.UPSTREAM_REFUSED);
    expect(r.content[0]?.text).toContain('Rate limit exceeded');
    expect((r as ErrorResult)._meta.suggestions).toEqual([
      'Wait 30 seconds before retrying',
      'Try a different model',
    ]);
    expect((r as ErrorResult)._meta.retry_after_seconds).toBe(30);
  });

  it('includes job metadata in failed response details', async () => {
    const pathMod = await import('node:path');
    const { promises: fsp } = await import('node:fs');

    const jobId = 'chat_20261011000002_001_beef4321';
    const createdAt = new Date().toISOString();
    const job: AsyncJob = {
      id: jobId,
      status: 'failed',
      createdAt,
      model: 'anthropic/claude-3.5-sonnet',
      error: 'Model not found',
      error_code: ErrorCode.MODEL_NOT_FOUND,
    };
    const jobDir = pathMod.join(sandbox, 'openrouter-jobs', jobId);
    await fsp.mkdir(jobDir, { recursive: true });
    await fsp.writeFile(pathMod.join(jobDir, 'status.json'), JSON.stringify(job));

    const r = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: jobId } },
    });
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.MODEL_NOT_FOUND);
    expect((r as ErrorResult)._meta.details).toMatchObject({
      job_id: jobId,
      model: 'anthropic/claude-3.5-sonnet',
      created_at: createdAt,
    });
  });
});

// ---------------------------------------------------------------------------
// 10–12. async-chat — job_id validation edge cases
// ---------------------------------------------------------------------------

describe('handleGetChatCompletionStatus — job_id validation', () => {
  beforeEach(() => resetAsyncJobStateForTests());
  afterEach(() => resetAsyncJobStateForTests());

  it('rejects job_id with path separators', async () => {
    const r = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: 'chat_../../etc/passwd' } },
    });
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0]?.text).toContain('Invalid job_id');
  });

  it('rejects job_id without chat_ prefix', async () => {
    const r = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: 'notchat_12345' } },
    });
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0]?.text).toContain('Must start with chat_');
  });

  it('rejects non-string job_id (number)', async () => {
    const r = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: 42 as unknown as string } },
    });
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0]?.text).toContain('job_id is required');
  });

  it('handles undefined arguments gracefully', async () => {
    const r = await handleGetChatCompletionStatus({
      params: { arguments: undefined as unknown as { job_id: string } },
    });
    expect(r.isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });
});

// ---------------------------------------------------------------------------
// 13. async-chat — still-running job response shape
// ---------------------------------------------------------------------------

describe('handleStartChatCompletion — running job response shape', () => {
  beforeEach(() => {
    resetAsyncJobStateForTests();
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
  });
  afterEach(() => {
    resetAsyncJobStateForTests();
    vi.unstubAllEnvs();
  });

  it('returns correct metadata for a newly started job', async () => {
    const neverResolve = new Promise(() => {});
    const openai = {
      chat: {
        completions: {
          create: vi.fn().mockReturnValue(neverResolve),
        },
      },
    } as unknown as OpenAI;

    const r = await handleStartChatCompletion(
      {
        params: {
          arguments: {
            messages: [{ role: 'user', content: 'hello' }],
            model: 'openai/gpt-4o',
          },
        },
      },
      openai,
    );
    expect(r.isError).toBeUndefined();
    expect(r._meta.server_version).toBe(SERVER_VERSION);
    expect(r._meta.status).toBe('running');
    expect(r._meta.model).toBe('openai/gpt-4o');
    expect(typeof r._meta.job_id).toBe('string');
    expect((r._meta.job_id as string).startsWith('chat_')).toBe(true);
    expect(r.content[0]?.text).toContain('get_chat_completion_status');
    expect(r.content[0]?.text).toContain(r._meta.job_id as string);
  });

  it('still-running job status check returns correct shape', async () => {
    const neverResolve = new Promise(() => {});
    const openai = {
      chat: {
        completions: {
          create: vi.fn().mockReturnValue(neverResolve),
        },
      },
    } as unknown as OpenAI;

    const start = await handleStartChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    const jobId = start._meta.job_id as string;

    const status = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: jobId } },
    });
    expect(status.isError).toBeUndefined();
    expect(status._meta.server_version).toBe(SERVER_VERSION);
    expect(status._meta.job_id).toBe(jobId);
    expect(status._meta.status).toBe('running');
    expect(status.content[0]?.text).toContain('still running');
    expect(status.content[0]?.text).toContain(jobId);
  });
});

// ---------------------------------------------------------------------------
// 14. embed_text — boolean model type
// ---------------------------------------------------------------------------

describe('handleEmbedText — model type edge cases', () => {
  it('rejects boolean model', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: true }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty string');
  });

  it('rejects null model', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: null }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects object model', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: { name: 'test' } }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// 15. decide — answers is a non-null non-object non-array type
// ---------------------------------------------------------------------------

describe('handleDecide — answers as non-object type from API', () => {
  it('returns INTERNAL when answers is a number', async () => {
    const client = mockDecideClient({ answers: 42 });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No answers returned');
  });

  it('returns INTERNAL when answers is a string', async () => {
    const client = mockDecideClient({ answers: 'not-an-object' });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No answers returned');
  });

  it('returns INTERNAL when answers is a boolean', async () => {
    const client = mockDecideClient({ answers: true });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });
});

// ---------------------------------------------------------------------------
// 16. decide — noul=-0 edge case
// ---------------------------------------------------------------------------

describe('handleDecide — noul=-0 edge case', () => {
  it('treats noul=-0 as P=0 which is < 0.5 → NO', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -0 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    // -0 is a finite number, so prob = -0; -0 >= 0.5 is false → NO
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});
