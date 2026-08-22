/** Async chat completions — in-memory jobs, optionally persisted under OPENROUTER_OUTPUT_DIR/openrouter-jobs/. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import { ErrorCode, toolError } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { extractCompletionText, buildCompletionMeta } from './completion-utils.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import {
  DEFAULT_CHAT_MODEL,
  type ChatToolRequest,
  buildChatCompletionBody,
  buildChatCompletionRequestOpts,
  asOpenAIChatBody,
  readIncludeReasoningDefault,
} from './chat-request.js';

export type StartChatCompletionRequest = ChatToolRequest;

export interface GetChatCompletionStatusRequest {
  job_id: string;
}

export type AsyncJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AsyncJob {
  id: string;
  status: AsyncJobStatus;
  createdAt: string;
  model: string;
  result?: {
    text: string;
    meta: Record<string, unknown>;
  };
  error?: string;
  error_code?: ErrorCode;
}

const jobs = new Map<string, AsyncJob>();
let jobCounter = 0;

function generateJobId(): string {
  jobCounter += 1;
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `chat_${ts}_${String(jobCounter).padStart(3, '0')}`;
}

function getJobsDir(): string | null {
  const outputDir = process.env.OPENROUTER_OUTPUT_DIR;
  if (!outputDir) return null;
  return path.join(outputDir, 'openrouter-jobs');
}

async function persistJob(job: AsyncJob): Promise<void> {
  const dir = getJobsDir();
  if (!dir) return;
  try {
    const jobDir = path.join(dir, job.id);
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(path.join(jobDir, 'status.json'), JSON.stringify(job, null, 2));
    if (job.status === 'completed' && job.result?.text) {
      await fs.writeFile(path.join(jobDir, 'response.md'), job.result.text);
    }
  } catch (err) {
    logger.warn('async_chat.persist_error', {
      job_id: job.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Load a persisted job from disk (exported for tests). */
export async function loadJobFromDisk(jobId: string): Promise<AsyncJob | null> {
  const dir = getJobsDir();
  if (!dir) return null;
  try {
    const raw = await fs.readFile(path.join(dir, jobId, 'status.json'), 'utf8');
    return JSON.parse(raw) as AsyncJob;
  } catch {
    return null;
  }
}

async function resolveJob(jobId: string): Promise<AsyncJob | undefined> {
  const inMemory = jobs.get(jobId);
  if (inMemory) return inMemory;

  const fromDisk = await loadJobFromDisk(jobId);
  if (fromDisk) {
    jobs.set(jobId, fromDisk);
    return fromDisk;
  }
  return undefined;
}

export async function handleStartChatCompletion(
  request: { params: { arguments: StartChatCompletionRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const args = request.params.arguments ?? ({ messages: [] } as StartChatCompletionRequest);
  const {
    messages,
    model,
    temperature,
    max_tokens,
    provider,
    include_reasoning,
    online,
    web_max_results,
    cache,
    cache_ttl,
    cache_clear,
  } = args;

  if (!messages?.length) {
    return toolError(ErrorCode.INVALID_INPUT, 'Messages array cannot be empty.');
  }

  const effectiveModel = model || defaultModel || DEFAULT_CHAT_MODEL;
  const jobId = generateJobId();

  const job: AsyncJob = {
    id: jobId,
    status: 'running',
    createdAt: new Date().toISOString(),
    model: effectiveModel,
  };
  jobs.set(jobId, job);

  logger.audit('async_chat.start', {
    job_id: jobId,
    model: effectiveModel,
    message_count: messages.length,
  });

  void runCompletionInBackground(job, openai, {
    messages,
    model: effectiveModel,
    temperature,
    max_tokens,
    provider,
    include_reasoning,
    online,
    web_max_results,
    cache,
    cache_ttl,
    cache_clear,
  });

  return {
    content: [
      {
        type: 'text' as const,
        text: `Chat completion job started. Use get_chat_completion_status with job_id="${jobId}" to check results.`,
      },
    ],
    _meta: {
      server_version: SERVER_VERSION,
      job_id: jobId,
      status: 'running' as const,
      model: effectiveModel,
    },
  };
}

async function runCompletionInBackground(
  job: AsyncJob,
  openai: OpenAI,
  opts: StartChatCompletionRequest & { model: string },
): Promise<void> {
  const wantsReasoning = opts.include_reasoning ?? readIncludeReasoningDefault();
  const body = buildChatCompletionBody(opts);
  const requestOpts = buildChatCompletionRequestOpts(opts);

  try {
    const completion = (await openai.chat.completions.create(
      asOpenAIChatBody(body),
      requestOpts,
    )) as ChatCompletion;
    const extracted = extractCompletionText(completion);

    if (!extracted.text) {
      job.status = 'failed';
      job.error = 'Model returned no textual content.';
    } else {
      job.status = 'completed';
      job.result = {
        text: extracted.text,
        meta: buildCompletionMeta(extracted, {
          includeReasoning: wantsReasoning,
          extra: { server_version: SERVER_VERSION },
        }),
      };
    }
  } catch (err) {
    job.status = 'failed';
    const classified = classifyUpstreamError(err);
    job.error = classified.content[0]?.text ?? 'Job failed.';
    job.error_code = classified._meta.code;
    logger.warn('async_chat.failed', { job_id: job.id, error: job.error, code: job.error_code });
  }

  await persistJob(job);
}

export async function handleGetChatCompletionStatus(request: {
  params: { arguments: GetChatCompletionStatusRequest };
}) {
  const args = request.params.arguments ?? ({} as GetChatCompletionStatusRequest);
  const jobId = args.job_id?.trim();

  if (!jobId) {
    return toolError(ErrorCode.INVALID_INPUT, 'job_id is required.');
  }

  const job = await resolveJob(jobId);
  if (!job) {
    const hint = getJobsDir()
      ? ' Jobs persist under OPENROUTER_OUTPUT_DIR/openrouter-jobs/ when that env var is set.'
      : ' Jobs are stored in memory for the current session only.';
    return toolError(ErrorCode.INVALID_INPUT, `No job found with id "${jobId}".${hint}`);
  }

  if (job.status === 'completed' && job.result) {
    return {
      content: [{ type: 'text' as const, text: job.result.text }],
      _meta: {
        server_version: SERVER_VERSION,
        job_id: jobId,
        status: 'completed' as const,
        model: job.model,
        created_at: job.createdAt,
        ...job.result.meta,
      },
    };
  }

  if (job.status === 'failed') {
    return toolError(job.error_code ?? ErrorCode.JOB_FAILED, job.error || 'Job failed.', {
      job_id: jobId,
      model: job.model,
      created_at: job.createdAt,
    });
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: `Job ${jobId} is still ${job.status}. Try again in a few seconds.`,
      },
    ],
    _meta: {
      server_version: SERVER_VERSION,
      job_id: jobId,
      status: job.status,
      model: job.model,
      created_at: job.createdAt,
    },
  };
}
