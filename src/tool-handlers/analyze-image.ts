import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions.js';
import { prepareImageUrl } from './image-utils.js';
import { UnsafeOutputPathError } from './path-safety.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
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
  validateCacheOptions,
} from './cache.js';
import { awaitCompletionWithHeaders } from './openai-withresponse.js';

const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';

export interface AnalyzeImageToolRequest extends CacheOptions {
  image_path: string;
  question?: string;
  model?: string;
  cache_input?: boolean;
}

export async function handleAnalyzeImage(
  request: { params: { arguments: AnalyzeImageToolRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const args = request.params.arguments ?? ({ image_path: '' } as AnalyzeImageToolRequest);
  const { image_path, question, model, cache_input, cache, cache_ttl, cache_clear } = args;

  if (!image_path) {
    return toolError(ErrorCode.INVALID_INPUT, 'image_path is required.');
  }

  const cacheError = validateCacheOptions({ cache, cache_ttl, cache_clear });
  if (cacheError) return cacheError;

  let imageUrl: string;
  try {
    imageUrl = await prepareImageUrl(image_path);
  } catch (err) {
    if (err instanceof UnsafeOutputPathError) {
      return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
    }
    const msg = err instanceof Error ? err.message : String(err);
    const detail = `image_path "${image_path}": ${msg}`;
    if (msg.includes('Blocked host')) {
      return toolError(ErrorCode.UPSTREAM_REFUSED, detail);
    }
    if (msg.toLowerCase().includes('too large')) {
      return toolError(ErrorCode.RESOURCE_TOO_LARGE, detail);
    }
    return toolError(ErrorCode.INVALID_INPUT, detail);
  }

  const imageBlock: Record<string, unknown> = {
    type: 'image_url',
    image_url: { url: imageUrl },
  };
  if (cache_input) imageBlock.cache_control = { type: 'ephemeral' };

  const headers = buildCacheHeaders({ cache, cache_ttl, cache_clear });
  const requestOpts = Object.keys(headers).length > 0 ? { headers } : undefined;

  let completion: ChatCompletion;
  let responseHeaders: Headers | undefined;
  try {
    const call = openai.chat.completions.create(
      {
        model: model || defaultModel || DEFAULT_MODEL,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: question || "What's in this image?" }, imageBlock],
          },
        ] as unknown as ChatCompletionMessageParam[],
      },
      requestOpts,
    );
    const { data, response } = await awaitCompletionWithHeaders(call);
    completion = data;
    responseHeaders = response?.headers;
  } catch (err) {
    return classifyUpstreamError(err);
  }

  const extracted = extractCompletionText(completion);
  const cutoff = detectReasoningCutoff(extracted);
  if (cutoff) return cutoff;

  if (!extracted.text) {
    return toolError(ErrorCode.INTERNAL, 'Vision model returned no textual content.', {
      finish_reason: extracted.finishReason,
    });
  }

  const cacheMeta = extractCacheMeta(responseHeaders);
  // Vision output may reflect untrusted image content — flag for downstream agents.
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
