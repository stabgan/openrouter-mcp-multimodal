import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions.js';
import { prepareAudioData } from './audio-utils.js';
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
} from './cache.js';
import { awaitCompletionWithHeaders } from './openai-withresponse.js';

const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export interface AnalyzeAudioToolRequest extends CacheOptions {
  audio_path: string;
  question?: string;
  model?: string;
  /**
   * Attach `cache_control: {type: 'ephemeral'}` to the audio block so
   * Claude / Gemini 2.5+ prompt-caches it. Repeat questions about the
   * same audio then cost dramatically less for the audio portion.
   */
  cache_input?: boolean;
}

export async function handleAnalyzeAudio(
  request: { params: { arguments: AnalyzeAudioToolRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const args = request.params.arguments ?? ({ audio_path: '' } as AnalyzeAudioToolRequest);
  const { audio_path, question, model, cache_input, cache, cache_ttl, cache_clear } = args;

  if (!audio_path) {
    return toolError(ErrorCode.INVALID_INPUT, 'audio_path is required.');
  }

  let audioData;
  try {
    audioData = await prepareAudioData(audio_path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Blocked host')) return toolErrorFrom(ErrorCode.UPSTREAM_REFUSED, err);
    if (msg.toLowerCase().includes('too large')) {
      return toolErrorFrom(ErrorCode.RESOURCE_TOO_LARGE, err);
    }
    if (msg.toLowerCase().includes('unsupported')) {
      return toolErrorFrom(ErrorCode.UNSUPPORTED_FORMAT, err);
    }
    return toolErrorFrom(ErrorCode.INVALID_INPUT, err);
  }

  const audioBlock: Record<string, unknown> = {
    type: 'input_audio',
    input_audio: { data: audioData.data, format: audioData.format },
  };
  if (cache_input) audioBlock.cache_control = { type: 'ephemeral' };

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
            content: [
              { type: 'text', text: question || 'Please transcribe and analyze this audio file.' },
              audioBlock,
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
    return classifyUpstreamError(err);
  }

  const extracted = extractCompletionText(completion);
  const cutoff = detectReasoningCutoff(extracted);
  if (cutoff) return cutoff;

  if (!extracted.text) {
    return toolError(ErrorCode.INTERNAL, 'Audio model returned no textual content.', {
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
