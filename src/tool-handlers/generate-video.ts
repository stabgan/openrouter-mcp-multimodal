import { extname } from 'node:path';
import type { OpenRouterAPIClient, VideoJobEnvelope, VideoJobStatus } from '../openrouter-api.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import {
  resolveOptionalOutputPath,
  isToolErrorResult,
  UnsafeOutputPathError,
} from './path-safety.js';
import { resolveImageBase64 } from './image-source.js';
import { readEnvInt } from './fetch-utils.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildBinaryToolResult } from './tool-result-payload.js';
import { replaceExtension, writeOutputFile } from './path-utils.js';
import {
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  type ProviderRoutingOptions,
} from './provider-routing.js';

const FALLBACK_MODEL = 'google/veo-3.1';
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_WAIT_MS = 10 * 60_000;
const MIN_POLL_INTERVAL_MS = 50; // just to avoid a 0ms busy-loop if a caller omits

/** Models deprecated by OpenAI — removal date: 2026-09-24. */
const SORA_DEPRECATED_MODELS = new Set([
  'openai/sora-2',
  'openai/sora-2-pro',
  'openai/sora-2-2025-10-06',
  'openai/sora-2-2025-12-08',
  'openai/sora-2-pro-2025-10-06',
]);

const SORA_REMOVAL_DATE = new Date('2026-09-24T00:00:00Z');

const SORA_ALTERNATIVES = [
  'google/veo-3.1 (recommended — fast, audio support)',
  'google/veo-3.1-fast (budget-friendly)',
  'bytedance/seedance-2.5 (high quality, up to 30s, 50 reference assets)',
  'bytedance/seedance-2.0-fast (fast turnaround)',
  'kwaivgi/kling-v3.0-pro (cinematic, first+last frame control)',
  'kwaivgi/kling-v3.0-std (standard tier)',
  'x-ai/grok-imagine-video (fast, $0.02/sec)',
  'alibaba/wan-2.7 (good for artistic styles)',
];

/** Return a deprecation warning for Sora models, or null. */
function checkSoraDeprecation(model: string): string | null {
  const normalized = model.toLowerCase().trim();
  if (!SORA_DEPRECATED_MODELS.has(normalized) && !normalized.startsWith('openai/sora')) {
    return null;
  }
  const isPastDeadline = Date.now() >= SORA_REMOVAL_DATE.getTime();
  const alternatives = SORA_ALTERNATIVES.map((a) => `  • ${a}`).join('\n');
  if (isPastDeadline) {
    return (
      `⚠️ REMOVED: ${model} was deprecated by OpenAI with a removal date of September 24, 2026, ` +
      `which has now passed. This model may no longer be available. ` +
      `Your request will still be attempted but is likely to fail. Recommended alternatives:\n` +
      alternatives
    );
  }
  return (
    `⚠️ DEPRECATION WARNING: ${model} is deprecated by OpenAI and will be removed from the API on September 24, 2026. ` +
    `Your request will still be attempted, but may fail. Recommended alternatives:\n` +
    alternatives
  );
}

export interface GenerateVideoToolRequest {
  prompt: string;
  model?: string;
  resolution?: string;
  aspect_ratio?: string;
  duration?: number;
  seed?: number;
  first_frame_image?: string;
  last_frame_image?: string;
  reference_images?: string[];
  provider?: Record<string, unknown>;
  save_path?: string;
  max_wait_ms?: number;
  poll_interval_ms?: number;
}

export interface GetVideoStatusToolRequest {
  video_id: string;
  save_path?: string;
}

type ProgressHook = (update: {
  status: string;
  progress?: number;
  attempt: number;
  video_id: string;
}) => void | Promise<void>;

function isTerminalFailureStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === 'failed' || normalized === 'cancelled' || normalized === 'canceled';
}

async function invokeProgressHook(
  hook: ProgressHook | undefined,
  update: Parameters<ProgressHook>[0],
) {
  if (!hook) return;
  try {
    await hook(update);
  } catch (err) {
    logger.warn('generate_video.progress_hook_error', {
      video_id: update.video_id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function getDefaultPollInterval(): number {
  return readEnvInt(
    'OPENROUTER_VIDEO_POLL_INTERVAL_MS',
    DEFAULT_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
  );
}

function getDefaultMaxWait(): number {
  return readEnvInt('OPENROUTER_VIDEO_MAX_WAIT_MS', DEFAULT_MAX_WAIT_MS, 10_000);
}

function getMaxDownloadBytes(): number {
  return readEnvInt('OPENROUTER_VIDEO_GEN_MAX_BYTES', 256 * 1024 * 1024, 1024 * 1024);
}

async function imageFrameEntry(
  source: string,
  frameType?: 'first_frame' | 'last_frame',
): Promise<{ kind: 'frame'; entry: Record<string, unknown> } | null> {
  if (!source) return null;
  const img = await resolveImageBase64(source);
  const entry: Record<string, unknown> = {
    type: 'image_url',
    image_url: { url: `data:${img.mime};base64,${img.data}` },
  };
  if (frameType) entry.frame_type = frameType;
  return { kind: 'frame', entry };
}

function buildRequestBody(args: GenerateVideoToolRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = { model, prompt: args.prompt };
  if (args.resolution) body.resolution = args.resolution;
  if (args.aspect_ratio) body.aspect_ratio = args.aspect_ratio;
  if (typeof args.duration === 'number') body.duration = args.duration;
  if (typeof args.seed === 'number') body.seed = args.seed;
  // provider is intentionally omitted — it is merged with env defaults
  // by the caller via mergeProviderOptions() + buildProviderBody().
  return body;
}

async function attachFrameImages(
  args: GenerateVideoToolRequest,
  body: Record<string, unknown>,
): Promise<void> {
  const frameTasks: Array<Promise<{ kind: 'frame'; entry: Record<string, unknown> } | null>> = [];

  if (args.first_frame_image) {
    frameTasks.push(imageFrameEntry(args.first_frame_image, 'first_frame'));
  }
  if (args.last_frame_image) {
    frameTasks.push(imageFrameEntry(args.last_frame_image, 'last_frame'));
  }

  const frameResults = await Promise.all(frameTasks);
  const frameImages = frameResults
    .filter((r): r is { kind: 'frame'; entry: Record<string, unknown> } => r !== null)
    .map((r) => r.entry);
  if (frameImages.length) body.frame_images = frameImages;

  if (args.reference_images?.length) {
    const refResults = await Promise.all(
      args.reference_images.map((src) => resolveImageBase64(src)),
    );
    const refs = refResults.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mime};base64,${img.data}` },
    }));
    if (refs.length) body.input_references = refs;
  }
}

async function pollUntilTerminal(
  apiClient: OpenRouterAPIClient,
  envelope: VideoJobEnvelope,
  opts: { pollIntervalMs: number; deadlineAt: number; onProgress?: ProgressHook },
): Promise<
  | { kind: 'completed'; status: VideoJobStatus }
  | { kind: 'failed'; status: VideoJobStatus }
  | { kind: 'timeout'; last: VideoJobStatus | null }
> {
  let attempt = 0;
  let last: VideoJobStatus | null = null;
  const initialStatus = (envelope.status ?? 'pending') as string;
  await invokeProgressHook(opts.onProgress, {
    status: initialStatus,
    attempt: 0,
    video_id: envelope.id,
  });

  while (Date.now() < opts.deadlineAt) {
    attempt += 1;
    await sleep(Math.min(opts.pollIntervalMs, Math.max(0, opts.deadlineAt - Date.now())));
    try {
      last = await apiClient.pollVideoJob(envelope.id);
    } catch (err) {
      logger.warn('generate_video.poll_error', {
        id: envelope.id,
        err: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    await invokeProgressHook(opts.onProgress, {
      status: last.status,
      progress: typeof last.progress === 'number' ? last.progress : undefined,
      attempt,
      video_id: envelope.id,
    });
    if (last.status === 'completed') return { kind: 'completed', status: last };
    if (isTerminalFailureStatus(last.status)) return { kind: 'failed', status: last };
  }
  return { kind: 'timeout', last };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

function extractJobError(status: VideoJobStatus): string {
  if (!status.error) return 'Upstream marked the job failed.';
  if (typeof status.error === 'string') return status.error;
  return status.error.message ?? 'Upstream marked the job failed.';
}

async function finalizeCompletedJob(
  apiClient: OpenRouterAPIClient,
  status: VideoJobStatus,
  savePath: string | null,
): Promise<{
  content: Array<Record<string, unknown>>;
  _meta: Record<string, unknown>;
}> {
  const url = status.unsigned_urls?.[0];
  if (!url) {
    throw new Error('Completed job returned no content URLs.');
  }

  const { buffer, contentType } = await apiClient.downloadVideoContent(
    status.id,
    0,
    getMaxDownloadBytes(),
  );
  if (buffer.length === 0) {
    throw new Error('Completed job returned empty video content.');
  }
  const mime = (contentType?.split(';')[0]?.trim() || 'video/mp4').toLowerCase();

  // CDN / reverse-proxy error pages sometimes return 200 with text/html.
  // Without this guard the HTML body would be saved as a .mp4 file that
  // cannot be played — silently corrupt output with no actionable error.
  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    throw new Error(
      `Video download returned ${mime} instead of a video format — ` +
        'likely a temporary CDN or upstream error. Retry after a brief delay.',
    );
  }

  const ext = mime.includes('webm')
    ? 'webm'
    : mime.includes('quicktime') || mime.includes('mov')
      ? 'mov'
      : mime.includes('mpeg') || mime.includes('mp2t')
        ? 'mpeg'
        : 'mp4';

  const baseMeta: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    video_id: status.id,
    mime,
    size_bytes: buffer.length,
  };
  if (status.usage) baseMeta.usage = status.usage;
  if (status.unsigned_urls) baseMeta.unsigned_urls = status.unsigned_urls;

  if (savePath) {
    const finalPath = extname(savePath) === `.${ext}` ? savePath : replaceExtension(savePath, ext);
    await writeOutputFile(finalPath, buffer);
    baseMeta.save_path = finalPath;
    const summaryNote = finalPath !== savePath ? ` (detected ${mime}, saved as ${finalPath})` : '';
    return buildBinaryToolResult(
      { kind: 'video', buffer, mimeType: mime },
      {
        savedPath: finalPath,
        summaryText: `Video saved to: ${finalPath}${summaryNote}`,
        meta: baseMeta,
      },
    );
  }

  return buildBinaryToolResult(
    { kind: 'video', buffer, mimeType: mime },
    {
      remoteUrl: url,
      meta: baseMeta,
    },
  );
}

export async function handleGenerateVideo(
  request: { params: { arguments: GenerateVideoToolRequest } },
  apiClient: OpenRouterAPIClient,
  progress?: ProgressHook,
) {
  const args = request.params.arguments ?? ({} as GenerateVideoToolRequest);
  if (!args.prompt || !args.prompt.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'prompt is required.');
  }

  if (
    typeof args.duration === 'number' &&
    (!Number.isFinite(args.duration) || args.duration <= 0)
  ) {
    return toolError(ErrorCode.INVALID_INPUT, 'duration must be a positive finite number.');
  }
  if (typeof args.seed === 'number' && !Number.isFinite(args.seed)) {
    return toolError(ErrorCode.INVALID_INPUT, 'seed must be a finite number.');
  }
  if (
    args.poll_interval_ms !== undefined &&
    (typeof args.poll_interval_ms !== 'number' ||
      !Number.isFinite(args.poll_interval_ms) ||
      args.poll_interval_ms <= 0)
  ) {
    return toolError(ErrorCode.INVALID_INPUT, 'poll_interval_ms must be a positive finite number.');
  }
  if (
    args.max_wait_ms !== undefined &&
    (typeof args.max_wait_ms !== 'number' ||
      !Number.isFinite(args.max_wait_ms) ||
      args.max_wait_ms <= 0)
  ) {
    return toolError(ErrorCode.INVALID_INPUT, 'max_wait_ms must be a positive finite number.');
  }

  if (args.reference_images !== undefined) {
    if (!Array.isArray(args.reference_images)) {
      return toolError(ErrorCode.INVALID_INPUT, 'reference_images must be an array of strings.');
    }
    if (args.reference_images.some((r) => typeof r !== 'string' || !r.trim())) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        'every reference_images entry must be a non-empty string.',
      );
    }
    if (args.reference_images.length > 50) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `reference_images has ${args.reference_images.length} entries — max 50.`,
      );
    }
  }

  const model =
    args.model?.trim() || process.env.OPENROUTER_DEFAULT_VIDEO_GEN_MODEL || FALLBACK_MODEL;

  const deprecationWarning = checkSoraDeprecation(model);

  logger.audit('generate_video.start', {
    model,
    prompt_preview: args.prompt.slice(0, 80),
    resolution: args.resolution,
    duration: args.duration,
    aspect_ratio: args.aspect_ratio,
    first_frame: args.first_frame_image ? 'provided' : 'none',
    last_frame: args.last_frame_image ? 'provided' : 'none',
    reference_images: args.reference_images?.length ?? 0,
    save_path: args.save_path ? 'provided' : 'none',
  });

  const savePathResult = await resolveOptionalOutputPath(args.save_path);
  if (isToolErrorResult(savePathResult)) return savePathResult;
  const safeSavePath = savePathResult.path;

  const body = buildRequestBody(args, model);

  // Merge user-supplied provider options with OPENROUTER_PROVIDER_* env defaults.
  // Previously generate_video bypassed env defaults — only chat tools applied them.
  const mergedProvider = buildProviderBody(
    mergeProviderOptions(readProviderDefaults(), args.provider as ProviderRoutingOptions),
  );
  if (mergedProvider) {
    body.provider = mergedProvider;
  }

  try {
    await attachFrameImages(args, body);
  } catch (err) {
    if (err instanceof UnsafeOutputPathError) {
      return toolErrorFrom(ErrorCode.UNSAFE_PATH, err, 'Reference/frame image');
    }
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (msg.includes('Blocked host')) {
      return toolErrorFrom(ErrorCode.UPSTREAM_REFUSED, err, 'Reference/frame image');
    }
    if (lower.includes('too large')) {
      return toolErrorFrom(ErrorCode.RESOURCE_TOO_LARGE, err, 'Reference/frame image');
    }
    if (lower.includes('timed out') || lower.includes('timeout')) {
      return toolErrorFrom(ErrorCode.UPSTREAM_TIMEOUT, err, 'Reference/frame image');
    }
    if (lower.includes('unsupported') || lower.includes('invalid data url')) {
      return toolErrorFrom(ErrorCode.UNSUPPORTED_FORMAT, err, 'Reference/frame image');
    }
    return toolErrorFrom(ErrorCode.INVALID_INPUT, err, 'Reference/frame image');
  }

  let envelope: VideoJobEnvelope;
  try {
    logger.info('generate_video.submit', { model, keys: Object.keys(body) });
    envelope = await apiClient.submitVideoJob(body);
  } catch (err) {
    return classifyUpstreamError(err, 'generate_video.submit');
  }

  const pollIntervalMs = Math.max(
    MIN_POLL_INTERVAL_MS,
    args.poll_interval_ms ?? getDefaultPollInterval(),
  );
  const maxWaitMs = Math.max(100, args.max_wait_ms ?? getDefaultMaxWait());
  const deadlineAt = Date.now() + maxWaitMs;

  const outcome = await pollUntilTerminal(apiClient, envelope, {
    pollIntervalMs,
    deadlineAt,
    onProgress: progress,
  });

  if (outcome.kind === 'failed') {
    const errorMsg = extractJobError(outcome.status);
    const details: Record<string, unknown> = { video_id: outcome.status.id };
    if (deprecationWarning) details.deprecated_model = true;
    return toolError(
      ErrorCode.JOB_FAILED,
      deprecationWarning ? `${deprecationWarning}\n\n${errorMsg}` : errorMsg,
      details,
    );
  }
  if (outcome.kind === 'timeout') {
    const timeoutContent: Array<{ type: string; text: string }> = [];
    if (deprecationWarning) {
      timeoutContent.push({ type: 'text' as const, text: deprecationWarning });
    }
    timeoutContent.push({
      type: 'text' as const,
      text: `Video still generating after ${maxWaitMs}ms. Use get_video_status with video_id=${envelope.id} to resume.`,
    });
    return {
      content: timeoutContent,
      isError: false as const,
      _meta: {
        server_version: SERVER_VERSION,
        code: ErrorCode.JOB_STILL_RUNNING,
        video_id: envelope.id,
        polling_url: envelope.polling_url ?? `https://openrouter.ai/api/v1/videos/${envelope.id}`,
        last_status: outcome.last?.status,
      },
    };
  }

  try {
    const { content, _meta } = await finalizeCompletedJob(apiClient, outcome.status, safeSavePath);
    if (deprecationWarning) {
      content.unshift({ type: 'text', text: deprecationWarning });
      (_meta as Record<string, unknown>).deprecated_model = true;
    }
    return { content, _meta };
  } catch (err) {
    if (err instanceof UnsafeOutputPathError) {
      return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
    }
    return toolErrorFrom(ErrorCode.UPSTREAM_HTTP, err, 'Download');
  }
}

export async function handleGetVideoStatus(
  request: { params: { arguments: GetVideoStatusToolRequest } },
  apiClient: OpenRouterAPIClient,
) {
  const args = request.params.arguments ?? ({} as GetVideoStatusToolRequest);
  const id = args.video_id?.trim();
  if (!id) return toolError(ErrorCode.INVALID_INPUT, 'video_id is required.');

  const savePathResult = await resolveOptionalOutputPath(args.save_path);
  if (isToolErrorResult(savePathResult)) return savePathResult;
  const safeSavePath = savePathResult.path;

  let status: VideoJobStatus;
  try {
    status = await apiClient.pollVideoJob(id);
  } catch (err) {
    return classifyUpstreamError(err, 'get_video_status.poll');
  }

  if (isTerminalFailureStatus(status.status)) {
    return toolError(ErrorCode.JOB_FAILED, extractJobError(status), { video_id: id });
  }
  if (status.status === 'completed') {
    try {
      const { content, _meta } = await finalizeCompletedJob(apiClient, status, safeSavePath);
      return { content, _meta };
    } catch (err) {
      if (err instanceof UnsafeOutputPathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
      return toolErrorFrom(ErrorCode.UPSTREAM_HTTP, err, 'Download');
    }
  }
  return {
    content: [
      {
        type: 'text' as const,
        text: `Video ${id} status: ${status.status}${
          typeof status.progress === 'number' ? ` (progress=${status.progress})` : ''
        }`,
      },
    ],
    isError: false as const,
    _meta: {
      server_version: SERVER_VERSION,
      code: ErrorCode.JOB_STILL_RUNNING,
      video_id: id,
      last_status: status.status,
      progress: status.progress,
    },
  };
}

/** Image-to-video wrapper — delegates to `handleGenerateVideo` with a narrower schema. */
export interface GenerateVideoFromImageRequest {
  image: string;
  prompt: string;
  model?: string;
  resolution?: string;
  aspect_ratio?: string;
  duration?: number;
  seed?: number;
  provider?: Record<string, unknown>;
  save_path?: string;
  max_wait_ms?: number;
  poll_interval_ms?: number;
}

export async function handleGenerateVideoFromImage(
  request: { params: { arguments: GenerateVideoFromImageRequest } },
  apiClient: OpenRouterAPIClient,
  progress?: ProgressHook,
) {
  const args = request.params.arguments ?? ({} as GenerateVideoFromImageRequest);
  if (!args.image?.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'image is required.');
  }
  if (!args.prompt || !args.prompt.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'prompt is required.');
  }
  return handleGenerateVideo(
    {
      params: {
        arguments: {
          prompt: args.prompt,
          first_frame_image: args.image,
          model: args.model,
          resolution: args.resolution,
          aspect_ratio: args.aspect_ratio,
          duration: args.duration,
          seed: args.seed,
          provider: args.provider,
          save_path: args.save_path,
          max_wait_ms: args.max_wait_ms,
          poll_interval_ms: args.poll_interval_ms,
        },
      },
    },
    apiClient,
    progress,
  );
}

export const _internals = {
  buildRequestBody,
  extractJobError,
  isTerminalFailureStatus,
  invokeProgressHook,
};
