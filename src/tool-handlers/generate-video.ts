import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import type {
  OpenRouterAPIClient,
  VideoJobEnvelope,
  VideoJobStatus,
} from '../openrouter-api.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import {
  resolveSafeOutputPath,
  resolveSafeInputPath,
  UnsafeOutputPathError,
} from './path-safety.js';
import { readEnvInt } from './fetch-utils.js';
import { classifyUpstreamError } from './openrouter-errors.js';

const FALLBACK_MODEL = 'google/veo-3.1';
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_WAIT_MS = 10 * 60_000;
const MIN_POLL_INTERVAL_MS = 50; // just to avoid a 0ms busy-loop if a caller omits
const INLINE_RETURN_CEILING_BYTES = 10 * 1024 * 1024;

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
  polling_url?: string;
}

type ProgressHook = (update: {
  status: string;
  progress?: number;
  attempt: number;
  video_id: string;
}) => void | Promise<void>;

function getMaxInlineBytes(): number {
  return readEnvInt(
    'OPENROUTER_VIDEO_INLINE_MAX_BYTES',
    INLINE_RETURN_CEILING_BYTES,
    4096,
  );
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
  // Generation output can be bigger than the input cap since it's our own
  // content. Default 256 MB, override via env.
  return readEnvInt(
    'OPENROUTER_VIDEO_GEN_MAX_BYTES',
    256 * 1024 * 1024,
    1024 * 1024,
  );
}

/**
 * Fold a caller-supplied image source (local path, http URL, or data URL)
 * into the `{ url: "data:video|image/...base64,..." }` shape OpenRouter
 * expects inside `frame_images[].image` / `input_references[]`.
 *
 * We reuse `prepareVideoData` for videos but images live in `image-utils`.
 * Since generate_video's references are images, not videos, we do a small
 * image-specific fetch here (data URL pass-through, HTTP via fetch-utils,
 * local via fs). We deliberately do NOT run them through sharp — the model
 * wants the pristine frame.
 */
async function prepareImageInput(
  source: string,
): Promise<{ data: string; mime: string } | null> {
  if (!source) return null;
  if (source.startsWith('data:')) {
    const match = source.match(/^data:([^;,]+)(?:;[^,]*)*;base64,(.+)$/);
    if (!match) throw new Error(`Invalid image data URL: ${source.slice(0, 40)}…`);
    return { mime: match[1]!, data: match[2]! };
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const { fetchHttpResource } = await import('./fetch-utils.js');
    const { buffer, contentType } = await fetchHttpResource(source, {
      timeoutMs: 30_000,
      maxBytes: 25 * 1024 * 1024,
      maxRedirects: 8,
    });
    const mime = (contentType?.split(';')[0]?.trim() || 'image/jpeg').toLowerCase();
    return { mime, data: buffer.toString('base64') };
  }
  // Local file: sandbox via path-safety's resolveSafeInputPath so
  // generate_video's first_frame_image / last_frame_image /
  // reference_images fields enforce the same OPENROUTER_INPUT_DIR
  // / OPENROUTER_OUTPUT_DIR / cwd scope that generate_image's
  // input_images already uses. Callers can still bypass with
  // OPENROUTER_ALLOW_UNSAFE_PATHS=1 for legacy scripts.
  const abs = await resolveSafeInputPath(source);
  const buf = await fs.readFile(abs);
  const ext = extname(abs).toLowerCase();
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.gif'
          ? 'image/gif'
          : 'image/jpeg';
  return { mime, data: buf.toString('base64') };
}

function buildRequestBody(args: GenerateVideoToolRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = { model, prompt: args.prompt };
  if (args.resolution) body.resolution = args.resolution;
  if (args.aspect_ratio) body.aspect_ratio = args.aspect_ratio;
  if (typeof args.duration === 'number') body.duration = args.duration;
  if (typeof args.seed === 'number') body.seed = args.seed;
  if (args.provider && typeof args.provider === 'object') body.provider = args.provider;
  return body;
}

async function attachFrameImages(
  args: GenerateVideoToolRequest,
  body: Record<string, unknown>,
): Promise<void> {
  const frameImages: Array<Record<string, unknown>> = [];
  if (args.first_frame_image) {
    const img = await prepareImageInput(args.first_frame_image);
    if (img) {
      frameImages.push({
        frame_type: 'first_frame',
        image: { url: `data:${img.mime};base64,${img.data}` },
      });
    }
  }
  if (args.last_frame_image) {
    const img = await prepareImageInput(args.last_frame_image);
    if (img) {
      frameImages.push({
        frame_type: 'last_frame',
        image: { url: `data:${img.mime};base64,${img.data}` },
      });
    }
  }
  if (frameImages.length) body.frame_images = frameImages;

  if (args.reference_images?.length) {
    const refs: Array<Record<string, unknown>> = [];
    for (const src of args.reference_images) {
      const img = await prepareImageInput(src);
      if (img) refs.push({ image: { url: `data:${img.mime};base64,${img.data}` } });
    }
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
  await opts.onProgress?.({ status: initialStatus, attempt: 0, video_id: envelope.id });

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
      continue; // transient; try again until deadline
    }
    await opts.onProgress?.({
      status: last.status,
      progress: typeof last.progress === 'number' ? last.progress : undefined,
      attempt,
      video_id: envelope.id,
    });
    if (last.status === 'completed') return { kind: 'completed', status: last };
    if (last.status === 'failed') return { kind: 'failed', status: last };
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
  const mime = (contentType?.split(';')[0]?.trim() || 'video/mp4').toLowerCase();
  const ext = mime.includes('webm')
    ? '.webm'
    : mime.includes('mov')
      ? '.mov'
      : mime.includes('mpeg')
        ? '.mpeg'
        : '.mp4';

  const baseMeta: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    video_id: status.id,
    mime,
    size_bytes: buffer.length,
  };
  if (status.usage) baseMeta.usage = status.usage;
  if (status.unsigned_urls) baseMeta.unsigned_urls = status.unsigned_urls;

  if (savePath) {
    const finalPath = extname(savePath) === ext ? savePath : stripAndReplaceExt(savePath, ext);
    await fs.writeFile(finalPath, buffer);
    baseMeta.save_path = finalPath;
    const summaryNote =
      finalPath !== savePath ? ` (detected ${mime}, saved as ${finalPath})` : '';
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: `Video saved to: ${finalPath}${summaryNote}` },
    ];
    if (buffer.length <= getMaxInlineBytes()) {
      content.push({
        type: 'video',
        mimeType: mime,
        data: buffer.toString('base64'),
      });
    }
    return { content, _meta: baseMeta };
  }

  // No save_path — return inline if small enough, otherwise just the URL.
  if (buffer.length <= getMaxInlineBytes()) {
    return {
      content: [
        { type: 'text', text: `Video generated (${buffer.length} bytes, ${mime}).` },
        { type: 'video', mimeType: mime, data: buffer.toString('base64') },
      ],
      _meta: baseMeta,
    };
  }
  return {
    content: [
      {
        type: 'text',
        text: `Video generated (${buffer.length} bytes, ${mime}). Too large to inline; pass save_path to persist. URL: ${url}`,
      },
    ],
    _meta: baseMeta,
  };
}

function stripAndReplaceExt(p: string, newExt: string): string {
  const cur = extname(p);
  const base = cur ? p.slice(0, -cur.length) : p;
  return base + newExt;
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

  const model =
    args.model ||
    process.env.OPENROUTER_DEFAULT_VIDEO_GEN_MODEL ||
    FALLBACK_MODEL;

  // Audit entry — video is the most expensive tool we have. Always log
  // model, resolution, duration, and a safe prompt preview so unintended
  // spend can be traced.
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

  // Fail-fast on unsafe save_path BEFORE spending credits on the job.
  let safeSavePath: string | null = null;
  if (args.save_path) {
    try {
      safeSavePath = await resolveSafeOutputPath(args.save_path);
    } catch (err) {
      if (err instanceof UnsafeOutputPathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
      return toolErrorFrom(ErrorCode.INTERNAL, err);
    }
  }

  const body = buildRequestBody(args, model);
  try {
    await attachFrameImages(args, body);
  } catch (err) {
    // Sandbox violation → UNSAFE_PATH; all other decode failures stay
    // as UNSUPPORTED_FORMAT (couldn't read, invalid data URL, etc.).
    if (err instanceof UnsafeOutputPathError) {
      return toolErrorFrom(ErrorCode.UNSAFE_PATH, err, 'Reference/frame image');
    }
    return toolErrorFrom(ErrorCode.UNSUPPORTED_FORMAT, err, 'Reference/frame image');
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
    return toolError(ErrorCode.JOB_FAILED, extractJobError(outcome.status), {
      video_id: outcome.status.id,
    });
  }
  if (outcome.kind === 'timeout') {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Video still generating after ${maxWaitMs}ms. Use get_video_status with video_id=${envelope.id} to resume.`,
        },
      ],
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
    const { content, _meta } = await finalizeCompletedJob(
      apiClient,
      outcome.status,
      safeSavePath,
    );
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

  // Pre-resolve save_path so the poll surfaces a fast error before hitting OpenRouter.
  let safeSavePath: string | null = null;
  if (args.save_path) {
    try {
      safeSavePath = await resolveSafeOutputPath(args.save_path);
    } catch (err) {
      if (err instanceof UnsafeOutputPathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
      return toolErrorFrom(ErrorCode.INTERNAL, err);
    }
  }

  let status: VideoJobStatus;
  try {
    status = await apiClient.pollVideoJob(id);
  } catch (err) {
    return classifyUpstreamError(err, 'get_video_status.poll');
  }

  if (status.status === 'failed') {
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

/**
 * Image-to-video convenience wrapper. Takes a single `image` argument
 * (first frame) and delegates to `handleGenerateVideo` with the broader
 * parameter surface hidden. Based on arxiv 2511.03497's finding that
 * tool-calling success degrades with parameter count — a narrower tool
 * gives the model a cleaner decision path.
 */
export interface GenerateVideoFromImageRequest {
  image: string;
  prompt: string;
  model?: string;
  resolution?: string;
  aspect_ratio?: string;
  duration?: number;
  seed?: number;
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
  if (!args.image) {
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

export const _internals = { buildRequestBody, stripAndReplaceExt, extractJobError };
