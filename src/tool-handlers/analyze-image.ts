import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import { prepareImageUrl } from './image-utils.js';
import { ErrorCode, toolError } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { classifyUpstreamError, classifyResourceLoadError } from './openrouter-errors.js';
import {
  extractCompletionText,
  detectReasoningCutoff,
  buildCompletionMeta,
  capResultText,
  classifyEmptyCompletion,
} from './completion-utils.js';
import {
  type CacheOptions,
  buildCacheHeaders,
  extractCacheMeta,
  validateCacheOptions,
} from './cache.js';
import { awaitCompletionWithHeaders } from './openai-withresponse.js';
import { asOpenAIChatBody } from './chat-request.js';
import {
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  type ProviderRoutingOptions,
} from './provider-routing.js';

const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';

export interface AnalyzeImageToolRequest extends CacheOptions {
  image_path: string;
  question?: string;
  model?: string;
  cache_input?: boolean;
  provider?: Record<string, unknown>;
}

export async function handleAnalyzeImage(
  request: { params: { arguments: AnalyzeImageToolRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const args = request.params.arguments ?? ({ image_path: '' } as AnalyzeImageToolRequest);
  const { image_path, question, model, cache_input, provider, cache, cache_ttl, cache_clear } =
    args;

  if (typeof image_path !== 'string' || !image_path.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'image_path is required.');
  }

  if (model !== undefined && typeof model !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'model must be a string.');
  }

  if (question !== undefined && typeof question !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'question must be a string.');
  }

  const cacheError = validateCacheOptions({ cache, cache_ttl, cache_clear });
  if (cacheError) return cacheError;

  let imageUrl: string;
  try {
    imageUrl = await prepareImageUrl(image_path);
  } catch (err) {
    return classifyResourceLoadError(err, `image_path "${image_path}"`);
  }

  const imageBlock: Record<string, unknown> = {
    type: 'image_url',
    image_url: { url: imageUrl },
  };
  if (cache_input) imageBlock.cache_control = { type: 'ephemeral' };

  const headers = buildCacheHeaders({ cache, cache_ttl, cache_clear });
  const requestOpts = Object.keys(headers).length > 0 ? { headers } : undefined;

  const body: Record<string, unknown> = {
    model: model?.trim() || defaultModel || DEFAULT_MODEL,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: question || "What's in this image?" }, imageBlock],
      },
    ],
  };

  // Merge user-supplied provider options with OPENROUTER_PROVIDER_* env defaults.
  const mergedProvider = buildProviderBody(
    mergeProviderOptions(readProviderDefaults(), provider as ProviderRoutingOptions),
  );
  if (mergedProvider) body.provider = mergedProvider;

  let completion: ChatCompletion;
  let responseHeaders: Headers | undefined;
  try {
    const call = openai.chat.completions.create(asOpenAIChatBody(body), requestOpts);
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
    return classifyEmptyCompletion(extracted, 'Vision model');
  }

  const cacheMeta = extractCacheMeta(responseHeaders);
  // Vision output may reflect untrusted image content — flag for downstream agents.
  const extra: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    content_is_untrusted: true,
  };
  if (cacheMeta) extra.cache = cacheMeta;

  const capped = capResultText(extracted.text);
  if (capped.truncated) extra.result_truncated = true;

  return {
    content: [{ type: 'text' as const, text: capped.text }],
    _meta: buildCompletionMeta(extracted, { extra }),
  };
}
