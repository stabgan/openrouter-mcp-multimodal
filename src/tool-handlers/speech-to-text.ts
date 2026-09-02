/** Dedicated POST /api/v1/audio/transcriptions — Whisper, GPT-4o Transcribe, Voxtral. */
import type { OpenRouterAPIClient, TranscriptionResponse } from '../openrouter-api.js';
import { STT_RESPONSE_FORMATS } from '../tool-definitions.js';
import { UnsafeOutputPathError } from './path-safety.js';
import { resolveSpeechToTextAudio } from './audio-utils.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { type CacheOptions, buildCacheHeaders, validateCacheOptions } from './cache.js';

export interface SpeechToTextRequest extends CacheOptions {
  audio_path: string;
  model?: string;
  language?: string;
  response_format?: string;
  temperature?: number;
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
    cache,
    cache_ttl,
    cache_clear,
  } = args;

  if (!audio_path?.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'audio_path is required.');
  }

  if (response_format && !VALID_RESPONSE_FORMATS.has(response_format)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `response_format '${response_format}' is not supported. Valid: ${[...VALID_RESPONSE_FORMATS].join(', ')}.`,
    );
  }

  if (typeof temperature === 'number' && (temperature < 0 || temperature > 1)) {
    return toolError(ErrorCode.INVALID_INPUT, 'temperature must be between 0 and 1 (inclusive).');
  }

  const cacheError = validateCacheOptions({ cache, cache_ttl, cache_clear });
  if (cacheError) return cacheError;

  logger.audit('speech_to_text.start', {
    model: model || DEFAULT_MODEL,
    audio_path: audio_path.startsWith('data:') ? 'data_url' : audio_path.slice(0, 80),
    language,
    response_format,
  });

  let audioInput: { data: string; format: string };
  try {
    audioInput = await resolveSpeechToTextAudio(audio_path);
  } catch (err) {
    if (err instanceof UnsafeOutputPathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
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

  const body: Record<string, unknown> = {
    model: model || DEFAULT_MODEL,
    input_audio: {
      data: audioInput.data,
      format: audioInput.format,
    },
  };
  if (language) body.language = language;
  if (response_format) body.response_format = response_format;
  if (typeof temperature === 'number') body.temperature = temperature;

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
    model: model || DEFAULT_MODEL,
  };
  if (response.language) baseMeta.language = response.language;
  if (response.duration) baseMeta.duration_seconds = response.duration;
  if (response.usage) baseMeta.usage = response.usage;

  return {
    content: [{ type: 'text' as const, text }],
    _meta: baseMeta,
  };
}
