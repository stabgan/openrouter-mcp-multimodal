/** Dedicated POST /api/v1/audio/transcriptions — Whisper, GPT-4o Transcribe, Voxtral. */
import type { OpenRouterAPIClient, TranscriptionResponse } from '../openrouter-api.js';
import { STT_RESPONSE_FORMATS } from '../tool-definitions.js';
import { resolveSpeechToTextAudio } from './audio-utils.js';
import { ErrorCode, toolError } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError, classifyResourceLoadError } from './openrouter-errors.js';
import { capResultText } from './completion-utils.js';
import { type CacheOptions, buildCacheHeaders, validateCacheOptions } from './cache.js';
import {
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  type ProviderRoutingOptions,
} from './provider-routing.js';

export interface SpeechToTextRequest extends CacheOptions {
  audio_path: string;
  model?: string;
  language?: string;
  response_format?: string;
  temperature?: number;
  provider?: Record<string, unknown>;
}

const DEFAULT_MODEL = 'openai/whisper-1';

const VALID_RESPONSE_FORMATS = new Set<string>(STT_RESPONSE_FORMATS);

function formatTranscriptionContent(
  response: TranscriptionResponse,
  responseFormat?: string,
): string | null {
  if (responseFormat === 'verbose_json') {
    return JSON.stringify(response, null, 2);
  }
  return response.text ?? null;
}

export async function handleSpeechToText(
  request: { params: { arguments: SpeechToTextRequest } },
  apiClient: OpenRouterAPIClient,
) {
  const args = request.params.arguments ?? ({} as SpeechToTextRequest);
  const {
    audio_path,
    model,
    language,
    response_format,
    temperature,
    provider,
    cache,
    cache_ttl,
    cache_clear,
  } = args;

  if (typeof audio_path !== 'string' || !audio_path.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'audio_path is required.');
  }

  if (model !== undefined && typeof model !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'model must be a string.');
  }

  if (response_format && !VALID_RESPONSE_FORMATS.has(response_format)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `response_format '${response_format}' is not supported. Valid: ${[...VALID_RESPONSE_FORMATS].join(', ')}.`,
    );
  }

  if (
    temperature !== undefined &&
    (typeof temperature !== 'number' ||
      !Number.isFinite(temperature) ||
      temperature < 0 ||
      temperature > 1)
  ) {
    return toolError(ErrorCode.INVALID_INPUT, 'temperature must be a number between 0 and 1.');
  }

  const cacheError = validateCacheOptions({ cache, cache_ttl, cache_clear });
  if (cacheError) return cacheError;

  logger.audit('speech_to_text.start', {
    model: model?.trim() || DEFAULT_MODEL,
    audio_path: audio_path.startsWith('data:') ? 'data_url' : audio_path.slice(0, 80),
    language,
    response_format,
  });

  let audioInput: { data: string; format: string };
  try {
    audioInput = await resolveSpeechToTextAudio(audio_path);
  } catch (err) {
    return classifyResourceLoadError(err);
  }

  const body: Record<string, unknown> = {
    model: model?.trim() || DEFAULT_MODEL,
    input_audio: {
      data: audioInput.data,
      format: audioInput.format,
    },
  };
  if (language) body.language = language;
  if (response_format) body.response_format = response_format;
  if (typeof temperature === 'number') body.temperature = temperature;

  // Merge user-supplied provider options with OPENROUTER_PROVIDER_* env defaults.
  const mergedProvider = buildProviderBody(
    mergeProviderOptions(readProviderDefaults(), provider as ProviderRoutingOptions),
  );
  if (mergedProvider) body.provider = mergedProvider;

  const headers = buildCacheHeaders({ cache, cache_ttl, cache_clear });

  let response: TranscriptionResponse;
  try {
    response = await apiClient.transcribeAudio(body, headers);
  } catch (err) {
    return classifyUpstreamError(err, 'speech_to_text');
  }

  const text = formatTranscriptionContent(response, response_format);
  if (!text) {
    return toolError(ErrorCode.INTERNAL, 'Transcription returned no text.', {
      response_keys: Object.keys(response),
    });
  }

  const baseMeta: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    model: model?.trim() || DEFAULT_MODEL,
    content_is_untrusted: true,
  };
  if (response.language) baseMeta.language = response.language;
  if (response.duration) baseMeta.duration_seconds = response.duration;
  if (response.usage) baseMeta.usage = response.usage;

  const capped = capResultText(text);
  if (capped.truncated) baseMeta.result_truncated = true;

  return {
    content: [{ type: 'text' as const, text: capped.text }],
    _meta: baseMeta,
  };
}
