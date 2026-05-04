import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions.js';
import { prepareVideoData } from './video-utils.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import {
  extractCompletionText,
  detectReasoningCutoff,
  buildCompletionMeta,
} from './completion-utils.js';
import {
  type CacheOptions,
  buildCacheHeaders,
  extractCacheMeta,
} from './cache.js';
import { awaitCompletionWithHeaders } from './openai-withresponse.js';

/**
 * Default model — `google/gemini-2.5-flash` has the widest video-input
 * support on OpenRouter at time of writing. Override via env
 * `OPENROUTER_DEFAULT_VIDEO_MODEL` or per-call `model`.
 */
const FALLBACK_DEFAULT_MODEL = 'google/gemini-2.5-flash';

export interface AnalyzeVideoToolRequest extends CacheOptions {
  video_path: string;
  question?: string;
  model?: string;
  /**
   * Attach `cache_control: {type: 'ephemeral'}` to the video block so
   * Claude / Gemini 2.5+ prompt-caches it. Very valuable for large
   * videos where repeat questions save 10x on Anthropic pricing.
   */
  cache_input?: boolean;
}

export async function handleAnalyzeVideo(
  request: { params: { arguments: AnalyzeVideoToolRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const args = request.params.arguments ?? ({ video_path: '' } as AnalyzeVideoToolRequest);
  const { video_path, question, model, cache_input, cache, cache_ttl, cache_clear } = args;

  if (!video_path) {
    return toolError(ErrorCode.INVALID_INPUT, 'video_path is required.');
  }

  const pickedModel =
    model ||
    process.env.OPENROUTER_DEFAULT_VIDEO_MODEL ||
    defaultModel ||
    FALLBACK_DEFAULT_MODEL;

  let videoData;
  try {
    videoData = await prepareVideoData(video_path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Blocked host')) {
      return toolErrorFrom(ErrorCode.UPSTREAM_REFUSED, err);
    }
    if (msg.includes('too large')) {
      return toolErrorFrom(ErrorCode.RESOURCE_TOO_LARGE, err);
    }
    if (msg.includes('Unsupported') || msg.includes('not a video')) {
      return toolErrorFrom(ErrorCode.UNSUPPORTED_FORMAT, err);
    }
    return toolErrorFrom(ErrorCode.INVALID_INPUT, err);
  }

  const videoBlock: Record<string, unknown> = {
    // The `video_url` content type is an OpenRouter extension; the OpenAI
    // SDK's typings don't know about it yet.
    type: 'video_url',
    video_url: { url: `data:${videoData.mediaType};base64,${videoData.data}` },
  };
  if (cache_input) videoBlock.cache_control = { type: 'ephemeral' };

  const headers = buildCacheHeaders({ cache, cache_ttl, cache_clear });
  const requestOpts = Object.keys(headers).length > 0 ? { headers } : undefined;

  let completion: ChatCompletion;
  let responseHeaders: Headers | undefined;
  try {
    logger.debug('analyze_video.submit', {
      model: pickedModel,
      format: videoData.format,
      size_bytes: videoData.sizeBytes,
    });
    const call = openai.chat.completions.create(
      {
        model: pickedModel,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: question || 'Describe what happens in this video, step by step.',
              },
              videoBlock,
            ],
          },
        ] as unknown as ChatCompletionMessageParam[],
      },
      requestOpts,
    );
    const { data, response } = await awaitCompletionWithHeaders(call);
    completion = data;
    responseHeaders = response?.headers;
  } catch (err) {
    logger.warn('analyze_video.error', {
      err: err instanceof Error ? err.message : String(err),
    });
    return classifyUpstreamError(err);
  }

  const extracted = extractCompletionText(completion);
  const cutoff = detectReasoningCutoff(extracted);
  if (cutoff) return cutoff;

  if (!extracted.text) {
    return toolError(ErrorCode.INTERNAL, 'Video model returned no textual content.', {
      finish_reason: extracted.finishReason,
    });
  }

  const cacheMeta = extractCacheMeta(responseHeaders);
  const extra: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    content_is_untrusted: true,
  };
  if (cacheMeta) extra.cache = cacheMeta;

  return {
    content: [{ type: 'text' as const, text: extracted.text }],
    _meta: buildCompletionMeta(extracted, { extra }),
  };
}
