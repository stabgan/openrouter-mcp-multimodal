import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  loadJobFromDisk,
  handleGetChatCompletionStatus,
  handleStartChatCompletion,
  generateJobId,
  resetAsyncJobStateForTests,
  type AsyncJob,
} from '../tool-handlers/async-chat.js';
import { ErrorCode } from '../errors.js';
import { isValidJobId } from '../tool-handlers/path-safety.js';
import OpenAI from 'openai';

function mockOpenAI(
  response: unknown,
  throws?: unknown,
): { openai: OpenAI; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  if (throws) create.mockRejectedValue(throws);
  else create.mockResolvedValue(response);
  const openai = { chat: { completions: { create } } } as unknown as OpenAI;
  return { openai, create };
}

async function writePersistedJob(outputRoot: string, job: AsyncJob): Promise<void> {
  const jobDir = path.join(outputRoot, 'openrouter-jobs', job.id);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, 'status.json'), JSON.stringify(job, null, 2));
  if (job.status === 'completed' && job.result?.text) {
    await fs.writeFile(path.join(jobDir, 'response.md'), job.result.text);
  }
}

describe('loadJobFromDisk', () => {
  let outputRoot: string;

  beforeEach(async () => {
    outputRoot = await fs.mkdtemp(path.join(tmpdir(), 'mcp-async-jobs-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', outputRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  it('returns null when OPENROUTER_OUTPUT_DIR is unset', async () => {
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
    await expect(loadJobFromDisk('chat_missing')).resolves.toBeNull();
  });

  it('returns null when the job file is missing', async () => {
    await expect(loadJobFromDisk('chat_not_on_disk')).resolves.toBeNull();
  });

  it('returns null when status.json is invalid JSON', async () => {
    const jobDir = path.join(outputRoot, 'openrouter-jobs', 'chat_bad_json');
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(path.join(jobDir, 'status.json'), '{not json');
    await expect(loadJobFromDisk('chat_bad_json')).resolves.toBeNull();
  });

  it('loads a persisted completed job', async () => {
    const job: AsyncJob = {
      id: 'chat_disk_completed',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      model: 'test/model',
      result: {
        text: 'Hello from disk',
        meta: { finish_reason: 'stop' },
      },
    };
    await writePersistedJob(outputRoot, job);
    await expect(loadJobFromDisk(job.id)).resolves.toEqual(job);
  });
});

describe('handleStartChatCompletion', () => {
  beforeEach(() => resetAsyncJobStateForTests());

  it('rejects empty messages', async () => {
    const { openai, create } = mockOpenAI({});
    const r = await handleStartChatCompletion({ params: { arguments: { messages: [] } } }, openai);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects invalid max_tokens before starting a job', async () => {
    const { openai, create } = mockOpenAI({});
    const r = await handleStartChatCompletion(
      {
        params: {
          arguments: { messages: [{ role: 'user', content: 'hi' }], max_tokens: -5 },
        },
      },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(create).not.toHaveBeenCalled();
  });

  it('returns running job metadata immediately', async () => {
    const { openai } = mockOpenAI({
      choices: [{ message: { content: 'later' }, finish_reason: 'stop' }],
    });
    const r = await handleStartChatCompletion(
      {
        params: {
          arguments: { messages: [{ role: 'user', content: 'hi' }], model: 'test/model' },
        },
      },
      openai,
    );
    expect(r.isError).toBeUndefined();
    expect((r as { _meta: Record<string, unknown> })._meta).toMatchObject({
      status: 'running',
      model: 'test/model',
    });
    expect((r as { content: Array<{ text: string }> }).content[0]!.text).toContain('job_id=');
  });
});

describe('async chat in-memory lifecycle', () => {
  beforeEach(() => resetAsyncJobStateForTests());

  it('completes job and returns text via status poll', async () => {
    const { openai } = mockOpenAI({
      choices: [{ message: { content: 'async result' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const start = await handleStartChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    const jobId = (start as { _meta: { job_id: string } })._meta.job_id;

    await vi.waitFor(
      async () => {
        const status = await handleGetChatCompletionStatus({
          params: { arguments: { job_id: jobId } },
        });
        expect(status.isError).toBeUndefined();
        expect((status as { content: Array<{ text: string }> }).content[0]!.text).toBe(
          'async result',
        );
      },
      { timeout: 3000, interval: 20 },
    );
  });

  it('marks job failed when model returns empty content', async () => {
    const { openai } = mockOpenAI({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
    });
    const start = await handleStartChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    const jobId = (start as { _meta: { job_id: string } })._meta.job_id;

    await vi.waitFor(
      async () => {
        const status = await handleGetChatCompletionStatus({
          params: { arguments: { job_id: jobId } },
        });
        expect(status.isError).toBe(true);
        expect((status as { _meta: { code: string } })._meta.code).toBe(ErrorCode.JOB_FAILED);
      },
      { timeout: 3000, interval: 20 },
    );
  });

  it('classifies upstream 429 on failed jobs', async () => {
    const rateLimitErr = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    const { openai } = mockOpenAI({}, rateLimitErr);
    const start = await handleStartChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    const jobId = (start as { _meta: { job_id: string } })._meta.job_id;

    await vi.waitFor(
      async () => {
        const status = await handleGetChatCompletionStatus({
          params: { arguments: { job_id: jobId } },
        });
        expect(status.isError).toBe(true);
        expect((status as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UPSTREAM_REFUSED);
      },
      { timeout: 3000, interval: 20 },
    );
  });
});

describe('handleGetChatCompletionStatus disk fallback', () => {
  let outputRoot: string;

  beforeEach(async () => {
    outputRoot = await fs.mkdtemp(path.join(tmpdir(), 'mcp-async-status-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', outputRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  it('requires job_id', async () => {
    const result = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: '   ' } },
    });
    expect(result.isError).toBe(true);
    expect((result as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns not-found when job is absent from memory and disk', async () => {
    const result = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: 'chat_absent' } },
    });
    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ text: string }> }).content[0]!.text).toContain(
      'No job found with id "chat_absent"',
    );
    expect((result as { content: Array<{ text: string }> }).content[0]!.text).toContain(
      'OPENROUTER_OUTPUT_DIR/openrouter-jobs/',
    );
  });

  it('mentions session-only storage when OPENROUTER_OUTPUT_DIR is unset', async () => {
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
    const result = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: 'chat_missing_mem' } },
    });
    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ text: string }> }).content[0]!.text).toContain(
      'memory for the current session only',
    );
  });

  it('preserves structured error_code from persisted failed jobs', async () => {
    const job: AsyncJob = {
      id: 'chat_disk_upstream_fail',
      status: 'failed',
      createdAt: '2026-01-05T00:00:00.000Z',
      model: 'test/model',
      error: 'HTTP 429: too many requests',
      error_code: ErrorCode.UPSTREAM_REFUSED,
    };
    await writePersistedJob(outputRoot, job);

    const result = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: job.id } },
    });
    expect(result.isError).toBe(true);
    expect((result as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UPSTREAM_REFUSED);
  });

  it('loads a completed job from disk when not in memory', async () => {
    const job: AsyncJob = {
      id: 'chat_disk_status_done',
      status: 'completed',
      createdAt: '2026-01-02T00:00:00.000Z',
      model: 'test/model',
      result: {
        text: 'Disk-only completion',
        meta: { finish_reason: 'stop', tokens: 12 },
      },
    };
    await writePersistedJob(outputRoot, job);

    const result = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: job.id } },
    });
    expect(result.isError).toBeUndefined();
    expect((result as { content: Array<{ text: string }> }).content[0]!.text).toBe(
      'Disk-only completion',
    );
    expect((result as { _meta: Record<string, unknown> })._meta).toMatchObject({
      job_id: job.id,
      status: 'completed',
      model: job.model,
      finish_reason: 'stop',
      tokens: 12,
    });
  });

  it('loads a failed job from disk', async () => {
    const job: AsyncJob = {
      id: 'chat_disk_status_failed',
      status: 'failed',
      createdAt: '2026-01-03T00:00:00.000Z',
      model: 'test/model',
      error: 'Upstream timeout',
    };
    await writePersistedJob(outputRoot, job);

    const result = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: job.id } },
    });
    expect(result.isError).toBe(true);
    expect((result as { _meta: { code: string } })._meta.code).toBe(ErrorCode.JOB_FAILED);
    expect((result as { content: Array<{ text: string }> }).content[0]!.text).toBe(
      'Upstream timeout',
    );
  });

  it('loads a running job from disk', async () => {
    const job: AsyncJob = {
      id: 'chat_disk_status_running',
      status: 'running',
      createdAt: '2026-01-04T00:00:00.000Z',
      model: 'test/model',
    };
    await writePersistedJob(outputRoot, job);

    const result = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: job.id } },
    });
    expect(result.isError).toBeUndefined();
    expect((result as { content: Array<{ text: string }> }).content[0]!.text).toContain(
      'still running',
    );
    expect((result as { _meta: Record<string, unknown> })._meta).toMatchObject({
      job_id: job.id,
      status: 'running',
    });
  });

  it('returns null for partial/corrupt status.json without throwing', async () => {
    const jobDir = path.join(outputRoot, 'openrouter-jobs', 'chat_partial_json');
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(path.join(jobDir, 'status.json'), '{"id":"chat_partial_json","status":');
    await expect(loadJobFromDisk('chat_partial_json')).resolves.toBeNull();
    await expect(
      handleGetChatCompletionStatus({ params: { arguments: { job_id: 'chat_partial_json' } } }),
    ).resolves.toMatchObject({ isError: true });
  });
});

describe('generateJobId', () => {
  beforeEach(() => resetAsyncJobStateForTests());

  it('produces ids accepted by isValidJobId including counter past 999', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1005; i++) {
      const id = generateJobId();
      expect(isValidJobId(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(1005);
  });
});

describe('async chat memory eviction', () => {
  beforeEach(() => resetAsyncJobStateForTests());
  afterEach(() => vi.unstubAllEnvs());

  it('evicts oldest terminal jobs when OPENROUTER_ASYNC_JOBS_MEMORY_MAX is exceeded', async () => {
    vi.stubEnv('OPENROUTER_ASYNC_JOBS_MEMORY_MAX', '3');
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
    const { openai } = mockOpenAI({
      choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
    });

    const jobIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const start = await handleStartChatCompletion(
        { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
        openai,
      );
      jobIds.push((start as { _meta: { job_id: string } })._meta.job_id);
    }

    for (const jobId of jobIds.slice(1)) {
      await vi.waitFor(
        async () => {
          const status = await handleGetChatCompletionStatus({
            params: { arguments: { job_id: jobId } },
          });
          expect(status.isError).toBeUndefined();
          expect((status as { content: Array<{ text: string }> }).content[0]!.text).toBe('done');
        },
        { timeout: 3000, interval: 20 },
      );
    }

    const evicted = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: jobIds[0]! } },
    });
    expect(evicted.isError).toBe(true);
    expect((evicted as { content: Array<{ text: string }> }).content[0]!.text).toContain(
      'No job found',
    );

    const latest = await handleGetChatCompletionStatus({
      params: { arguments: { job_id: jobIds[3]! } },
    });
    expect(latest.isError).toBeUndefined();
  });

  it('resolves completed jobs in memory even when persist fails', async () => {
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '/definitely/not/writable/on/test/system');
    const { openai } = mockOpenAI({
      choices: [{ message: { content: 'memory only' }, finish_reason: 'stop' }],
    });
    const start = await handleStartChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    const jobId = (start as { _meta: { job_id: string } })._meta.job_id;

    await vi.waitFor(
      async () => {
        const status = await handleGetChatCompletionStatus({
          params: { arguments: { job_id: jobId } },
        });
        expect(status.isError).toBeUndefined();
        expect((status as { content: Array<{ text: string }> }).content[0]!.text).toBe(
          'memory only',
        );
      },
      { timeout: 3000, interval: 20 },
    );
  });
});
