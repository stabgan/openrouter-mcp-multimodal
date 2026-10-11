/** Dedicated POST /api/v1/audio/transcriptions — Whisper, GPT-4o Transcribe, Voxtral. */
import type { OpenRouterAPIClient, TranscriptionResponse } from '../openrouter-api.js';
import { STT_RESPONSE_FORMATS } from '../tool-definitions.js';
import { resolveSpeechToTextAudio } from './audio-utils.js';
import { ErrorCode, toolError } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError, classifyResourceLoadError } from './openrouter-errors.js';
import { sanitizeUpstreamUsage } from './sanitize-usage.js';
import { capResultText } from './completion-utils.js';
import { type CacheOptions, buildCacheHeaders, validateCacheOptions } from './cache.js';
import {
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  validateProviderOptions,
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

/**
 * Model IDs follow the `org/model-name[:suffix]` pattern — 256 chars is
 * generous for any real identifier while preventing multi-megabyte strings
 * from inflating API request bodies, log entries, and MCP responses.
 */
const MAX_MODEL_ID_LENGTH = 256;

/**
 * Language tag length limit.  ISO 639-1 codes are 2–3 characters; BCP 47
 * tags with script and region subtags rarely exceed 35.  64 chars is generous
 * for any real tag while preventing multi-megabyte strings from inflating
 * the serialized request body and log entries.
 */
const MAX_LANGUAGE_LENGTH = 64;

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
  if (typeof model === 'string' && model.length > MAX_MODEL_ID_LENGTH) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `model identifier exceeds max length ${MAX_MODEL_ID_LENGTH} (got ${model.length}).`,
    );
  }

  // Validate response_format type — MCP clients that ignore the JSON schema
  // can send numbers, booleans, or objects.  Without this guard, non-string
  // values pass the falsy check or produce confusing "not supported" errors
  // from the Set check instead of a clear type error.  Matches the explicit
  // typeof checks applied to every other string enum parameter across all
  // tool handlers (aspect_ratio, resolution, quality, output_format, etc.).
  if (
    response_format !== undefined &&
    response_format !== null &&
    typeof response_format !== 'string'
  ) {
    return toolError(ErrorCode.INVALID_INPUT, 'response_format must be a string.');
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

  if (language !== undefined && typeof language !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'language must be a string.');
  }
  if (typeof language === 'string' && language.length > MAX_LANGUAGE_LENGTH) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `language exceeds max length ${MAX_LANGUAGE_LENGTH} (got ${language.length}).`,
    );
  }

  const cacheError = validateCacheOptions({ cache, cache_ttl, cache_clear });
  if (cacheError) return cacheError;

  const providerError = validateProviderOptions(provider);
  if (providerError) return providerError;

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
  // Sanitize upstream metadata — the response is untrusted.  `language` and
  // `duration` were forwarded raw; a malformed upstream could return a
  // multi-megabyte string for `language` or NaN/Infinity for `duration`,
  // inflating the MCP response or causing type confusion in consumers.
  if (typeof response.language === 'string' && response.language.length > 0) {
    // Real language codes are 2–35 chars (BCP 47); cap at 64 matching the
    // MAX_LANGUAGE_LENGTH ceiling for user input.
    baseMeta.language =
      response.language.length > MAX_LANGUAGE_LENGTH
        ? response.language.slice(0, MAX_LANGUAGE_LENGTH)
        : response.language;
  }
  if (typeof response.duration === 'number' && Number.isFinite(response.duration)) {
    baseMeta.duration_seconds = response.duration;
  }
  const safeUsage = sanitizeUpstreamUsage(response.usage);
  if (safeUsage) baseMeta.usage = safeUsage;

  const capped = capResultText(text);
  if (capped.truncated) baseMeta.result_truncated = true;

  return {
    content: [{ type: 'text' as const, text: capped.text }],
    _meta: baseMeta,
  };
}
