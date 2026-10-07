import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import { prepareAudioData } from './audio-utils.js';
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

const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export interface AnalyzeAudioToolRequest extends CacheOptions {
  audio_path: string;
  question?: string;
  model?: string;
  cache_input?: boolean;
  provider?: Record<string, unknown>;
}

export async function handleAnalyzeAudio(
  request: { params: { arguments: AnalyzeAudioToolRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const args = request.params.arguments ?? ({ audio_path: '' } as AnalyzeAudioToolRequest);
  const { audio_path, question, model, cache_input, provider, cache, cache_ttl, cache_clear } =
    args;

  if (typeof audio_path !== 'string' || !audio_path.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'audio_path is required.');
  }

  const cacheError = validateCacheOptions({ cache, cache_ttl, cache_clear });
  if (cacheError) return cacheError;

  let audioData;
  try {
    audioData = await prepareAudioData(audio_path);
  } catch (err) {
    return classifyResourceLoadError(err);
  }

  const audioBlock: Record<string, unknown> = {
    type: 'input_audio',
    input_audio: { data: audioData.data, format: audioData.format },
  };
  if (cache_input) audioBlock.cache_control = { type: 'ephemeral' };

  const headers = buildCacheHeaders({ cache, cache_ttl, cache_clear });
  const requestOpts = Object.keys(headers).length > 0 ? { headers } : undefined;

  const body: Record<string, unknown> = {
    model: model?.trim() || defaultModel || DEFAULT_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: question || 'Please transcribe and analyze this audio file.' },
          audioBlock,
        ],
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
    return classifyEmptyCompletion(extracted, 'Audio model');
  }

  const cacheMeta = extractCacheMeta(responseHeaders);
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
