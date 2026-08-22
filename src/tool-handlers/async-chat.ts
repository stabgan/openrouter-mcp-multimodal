/**
 * Async chat completions — resumable workflow for long-running requests.
 *
 * Problem: Remote MCP bridges (Cowork, etc.) kill tool calls after ~60s.
 * Reasoning models can take much longer. Unlike video, `chat_completion`
 * currently has no background job mechanism.
 *
 * Solution: Two tools that mirror the video pattern:
 *  - `start_chat_completion` — fires off the request in the background,
 *    returns a `job_id` immediately.
 *  - `get_chat_completion_status` — returns queued/running/completed/failed,
 *    with the final response on completion.
 *
 * Job state is held in memory (survives within a single MCP session).
 * Optionally persisted to OPENROUTER_OUTPUT_DIR/openrouter-jobs/ for
 * crash recovery.
 */
import { promises as fs } from 'fs';
import path from 'node:path';
import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions.js';
import { ErrorCode, toolError } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { extractCompletionText, buildCompletionMeta } from './completion-utils.js';
import {
  type ProviderRoutingOptions,
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  resolveMaxTokens,
} from './provider-routing.js';
import { type CacheOptions, buildCacheHeaders } from './cache.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StartChatCompletionRequest extends CacheOptions {
  messages: ChatCompletionMessageParam[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  provider?: ProviderRoutingOptions;
  include_reasoning?: boolean;
  online?: boolean;
  web_max_results?: number;
}

export interface GetChatCompletionStatusRequest {
  job_id: string;
}

export type AsyncJobStatus = 'queued' | 'running' | 'completed' | 'failed';

interface AsyncJob {
  id: string;
  status: AsyncJobStatus;
  createdAt: string;
  model: string;
  result?: {
    text: string;
    meta: Record<string, unknown>;
  };
  error?: string;
}

// ─── Job Store ───────────────────────────────────────────────────────────────

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

// ─── Handlers ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

function readIncludeReasoningDefault(): boolean {
  const raw = (process.env.OPENROUTER_INCLUDE_REASONING ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
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

  const effectiveModel = model || defaultModel || DEFAULT_MODEL;
  const jobId = generateJobId();

  // Create the job immediately
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

  // Fire and forget — the completion runs in the background
  runCompletionInBackground(job, openai, {
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

  // Return immediately with the job ID
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
  const providerOptions = mergeProviderOptions(readProviderDefaults(), opts.provider);
  const providerBody = buildProviderBody(providerOptions);
  const effectiveMaxTokens = resolveMaxTokens(opts.max_tokens);
  const wantsReasoning = opts.include_reasoning ?? readIncludeReasoningDefault();

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 1,
  };
  if (typeof effectiveMaxTokens === 'number') body.max_tokens = effectiveMaxTokens;
  if (providerBody) body.provider = providerBody;
  if (wantsReasoning) body.include_reasoning = true;
  if (opts.online) {
    const plugin: Record<string, unknown> = { id: 'web' };
    if (typeof opts.web_max_results === 'number' && opts.web_max_results > 0) {
      plugin.max_results = opts.web_max_results;
    }
    body.plugins = [plugin];
  }

  const headers = buildCacheHeaders({
    cache: opts.cache,
    cache_ttl: opts.cache_ttl,
    cache_clear: opts.cache_clear,
  });
  const requestOpts = Object.keys(headers).length > 0 ? { headers } : undefined;

  try {
    const completion = (await openai.chat.completions.create(
      body as unknown as Parameters<typeof openai.chat.completions.create>[0],
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
    job.error = err instanceof Error ? err.message : String(err);
    logger.warn('async_chat.failed', { job_id: job.id, error: job.error });
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

  const job = jobs.get(jobId);
  if (!job) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `No job found with id "${jobId}". Jobs are stored in memory for the current session only.`,
    );
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
    return toolError(ErrorCode.JOB_FAILED, job.error || 'Job failed.', {
      job_id: jobId,
      model: job.model,
      created_at: job.createdAt,
    });
  }

  // Still running
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
