/** Async chat completions — in-memory jobs, optionally persisted under OPENROUTER_OUTPUT_DIR/openrouter-jobs/. */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import { ErrorCode, toolError } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import {
  extractCompletionText,
  detectReasoningCutoff,
  buildCompletionMeta,
  capResultText,
  classifyEmptyCompletion,
} from './completion-utils.js';
import { resolveSafeJobStatusPath, isValidJobId } from './path-safety.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { validateCacheOptions } from './cache.js';
import {
  DEFAULT_CHAT_MODEL,
  type ChatToolRequest,
  buildChatCompletionBody,
  buildChatCompletionRequestOpts,
  asOpenAIChatBody,
  readIncludeReasoningDefault,
  validateChatMessages,
  validateTemperature,
  validateMaxTokens,
  validateResponseFormat,
  validateWebSearchOptions,
  validateReasoningEffort,
  validateStop,
  validateTopP,
  validatePenalty,
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
  /** Actionable suggestions from the classified error (e.g. "Retry", "Top up credits"). */
  error_suggestions?: string[];
  /** Seconds the caller should wait before retrying (from Retry-After header). */
  retry_after_seconds?: number;
}

const jobs = new Map<string, AsyncJob>();
let jobCounter = 0;

const DEFAULT_ASYNC_JOBS_MEMORY_MAX = 200;

function readAsyncJobsMemoryMax(): number {
  const raw = process.env.OPENROUTER_ASYNC_JOBS_MEMORY_MAX;
  if (raw === undefined || raw === '') return DEFAULT_ASYNC_JOBS_MEMORY_MAX;
  if (raw === '0') return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ASYNC_JOBS_MEMORY_MAX;
}

function evictTerminalJobsIfNeeded(makeRoomForNew = false): void {
  const max = readAsyncJobsMemoryMax();
  if (max <= 0 || jobs.size < max) return;

  const terminal = [...jobs.entries()]
    .filter(([, job]) => job.status === 'completed' || job.status === 'failed')
    .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));

  // When called from rememberJob (makeRoomForNew=true), we need to free one
  // slot so the incoming entry does not push the map past max.  Background
  // cleanup (makeRoomForNew=false) only trims entries that already exceed max.
  const threshold = makeRoomForNew ? max : max + 1;
  while (jobs.size >= threshold && terminal.length > 0) {
    const [id] = terminal.shift()!;
    jobs.delete(id);
  }
}

function rememberJob(job: AsyncJob): void {
  evictTerminalJobsIfNeeded(true);
  jobs.set(job.id, job);
}

/** Test-only reset for module-level job state. */
export function resetAsyncJobStateForTests(): void {
  jobs.clear();
  jobCounter = 0;
}

/** Exported for tests — produces ids accepted by `isValidJobId`. */
export function generateJobId(): string {
  jobCounter += 1;
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const entropy = randomBytes(4).toString('hex');
  return `chat_${ts}_${String(jobCounter).padStart(3, '0')}_${entropy}`;
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
  const statusPath = await resolveSafeJobStatusPath(dir, jobId);
  if (!statusPath) return null;
  try {
    const raw = await fs.readFile(statusPath, 'utf8');
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
    // Re-check after the async disk read: a concurrent resolveJob call (or a
    // background task completing) may have inserted this job while we were
    // awaiting I/O.  Prefer the in-memory entry to avoid an unnecessary
    // eviction inside rememberJob and a stale-disk overwrite.
    const recheck = jobs.get(jobId);
    if (recheck) return recheck;

    rememberJob(fromDisk);
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
    reasoning_effort,
    online,
    web_max_results,
    web_blocked_domains,
    fusion,
    subagent,
    response_healing,
    stop,
    top_p,
    frequency_penalty,
    presence_penalty,
    cache,
    cache_ttl,
    cache_clear,
  } = args;

  const messagesError = validateChatMessages(messages);
  if (messagesError) return messagesError;

  if (model !== undefined && typeof model !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'model must be a string.');
  }

  const cacheError = validateCacheOptions({ cache, cache_ttl, cache_clear });
  if (cacheError) return cacheError;

  const temperatureError = validateTemperature(temperature);
  if (temperatureError) return temperatureError;

  const maxTokensError = validateMaxTokens(max_tokens);
  if (maxTokensError) return maxTokensError;

  const responseFormatError = validateResponseFormat(args.response_format);
  if (responseFormatError) return responseFormatError;

  const webSearchError = validateWebSearchOptions(web_max_results, web_blocked_domains, online);
  if (webSearchError) return webSearchError;

  const reasoningEffortError = validateReasoningEffort(reasoning_effort);
  if (reasoningEffortError) return reasoningEffortError;

  const stopError = validateStop(stop);
  if (stopError) return stopError;

  const topPError = validateTopP(top_p);
  if (topPError) return topPError;

  const freqPenaltyError = validatePenalty(frequency_penalty, 'frequency_penalty');
  if (freqPenaltyError) return freqPenaltyError;

  const presPenaltyError = validatePenalty(presence_penalty, 'presence_penalty');
  if (presPenaltyError) return presPenaltyError;

  const effectiveModel = model?.trim() || defaultModel || DEFAULT_CHAT_MODEL;
  const jobId = generateJobId();

  const job: AsyncJob = {
    id: jobId,
    status: 'running',
    createdAt: new Date().toISOString(),
    model: effectiveModel,
  };
  rememberJob(job);

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
    reasoning_effort,
    online,
    web_max_results,
    web_blocked_domains,
    fusion,
    subagent,
    response_healing,
    response_format: args.response_format,
    stop,
    top_p,
    frequency_penalty,
    presence_penalty,
    cache,
    cache_ttl,
    cache_clear,
  }).catch((err) => {
    // Guarded so a throw here cannot surface as an unhandledRejection
    // (the entire chain is void-ed).
    try {
      logger.error('async_chat.unhandled', {
        job_id: job.id,
        err: err instanceof Error ? err.message : String(err),
      });
      if (job.status === 'running') {
        job.status = 'failed';
        job.error = 'Unexpected error during background completion.';
        job.error_code = ErrorCode.INTERNAL;
      }
      // Best-effort persist + evict — mirrors the cleanup at the end of
      // runCompletionInBackground that may not have executed.
      persistJob(job).catch(() => undefined);
      evictTerminalJobsIfNeeded();
    } catch {
      /* last-resort guard — never let .catch() itself reject */
    }
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
  try {
    const cacheError = validateCacheOptions(opts);
    if (cacheError) {
      job.status = 'failed';
      job.error = cacheError.content[0]?.text ?? 'Invalid cache options.';
      job.error_code = cacheError._meta.code;
      await persistJob(job);
      evictTerminalJobsIfNeeded();
      return;
    }

    const wantsReasoning = opts.include_reasoning ?? readIncludeReasoningDefault();
    const body = buildChatCompletionBody(opts);
    const requestOpts = buildChatCompletionRequestOpts(opts);

    try {
      const completion = (await openai.chat.completions.create(
        asOpenAIChatBody(body),
        requestOpts,
      )) as ChatCompletion;
      const extracted = extractCompletionText(completion);

      const cutoff = detectReasoningCutoff(extracted);
      if (cutoff) {
        job.status = 'failed';
        job.error = cutoff.content[0]?.text ?? 'Reasoning cutoff detected.';
        job.error_code = cutoff._meta.code;
        await persistJob(job);
        evictTerminalJobsIfNeeded();
        return;
      }

      if (!extracted.text) {
        job.status = 'failed';
        const classified = classifyEmptyCompletion(extracted, 'Model');
        job.error_code = classified._meta.code;
        job.error = classified.content[0]?.text ?? 'Model returned no textual content.';
        if (classified._meta.suggestions) {
          job.error_suggestions = classified._meta.suggestions as string[];
        }
      } else {
        job.status = 'completed';
        // Web search injects untrusted web content into the model's context —
        // flag the output so downstream agents treat it with appropriate caution.
        const completionExtra: Record<string, unknown> = { server_version: SERVER_VERSION };
        if (opts.online) completionExtra.content_is_untrusted = true;
        job.result = {
          text: extracted.text,
          meta: buildCompletionMeta(extracted, {
            includeReasoning: wantsReasoning,
            extra: completionExtra,
          }),
        };
      }
    } catch (err) {
      job.status = 'failed';
      const classified = classifyUpstreamError(err);
      job.error = classified.content[0]?.text ?? 'Job failed.';
      job.error_code = classified._meta.code;
      if (classified._meta.suggestions) job.error_suggestions = classified._meta.suggestions;
      if (typeof classified._meta.retry_after_seconds === 'number') {
        job.retry_after_seconds = classified._meta.retry_after_seconds;
      }
      logger.warn('async_chat.failed', { job_id: job.id, error: job.error, code: job.error_code });
    }
  } catch (err) {
    job.status = 'failed';
    job.error = 'Unexpected error during background completion.';
    job.error_code = ErrorCode.INTERNAL;
    logger.error('async_chat.background_error', {
      job_id: job.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  await persistJob(job);
  evictTerminalJobsIfNeeded();
}

export async function handleGetChatCompletionStatus(request: {
  params: { arguments: GetChatCompletionStatusRequest };
}) {
  const args = request.params.arguments ?? ({} as GetChatCompletionStatusRequest);
  const jobId = typeof args.job_id === 'string' ? args.job_id.trim() : '';

  if (!jobId) {
    return toolError(ErrorCode.INVALID_INPUT, 'job_id is required.');
  }

  if (!isValidJobId(jobId)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `Invalid job_id "${jobId}". Must start with chat_ and must not contain path separators.`,
    );
  }

  const job = await resolveJob(jobId);
  if (!job) {
    const hint = getJobsDir()
      ? ' Jobs persist under OPENROUTER_OUTPUT_DIR/openrouter-jobs/ when that env var is set.'
      : ' Jobs are stored in memory for the current session only.';
    return toolError(ErrorCode.INVALID_INPUT, `No job found with id "${jobId}".${hint}`);
  }

  if (job.status === 'completed' && job.result) {
    const capped = capResultText(job.result.text);
    return {
      content: [{ type: 'text' as const, text: capped.text }],
      _meta: {
        server_version: SERVER_VERSION,
        job_id: jobId,
        status: 'completed' as const,
        model: job.model,
        created_at: job.createdAt,
        ...(capped.truncated ? { result_truncated: true } : {}),
        ...job.result.meta,
      },
    };
  }

  if (job.status === 'failed') {
    return toolError(
      job.error_code ?? ErrorCode.JOB_FAILED,
      job.error || 'Job failed.',
      {
        job_id: jobId,
        model: job.model,
        created_at: job.createdAt,
      },
      {
        suggestions: job.error_suggestions,
        retry_after_seconds: job.retry_after_seconds,
      },
    );
  }

  // Guard: completed but result data is missing (corrupted persisted job file
  // or unexpected code path). Without this the function would fall through to
  // the "still running" branch, confusingly saying "Job X is still completed."
  if (job.status === 'completed') {
    return toolError(
      ErrorCode.INTERNAL,
      `Job ${jobId} completed but result data is missing. The job may need to be re-run.`,
      {
        job_id: jobId,
        model: job.model,
        created_at: job.createdAt,
      },
    );
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
