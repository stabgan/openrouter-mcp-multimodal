/** Dedicated POST /api/v1/audio/speech. */
import { extname } from 'node:path';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { TTS_RESPONSE_FORMATS } from '../tool-definitions.js';
import {
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_RESPONSE_FORMAT,
  DEFAULT_TTS_VOICE,
} from '../tts-defaults.js';
import { resolveOptionalOutputPath, isToolErrorResult } from './path-safety.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildBinaryToolResult } from './tool-result-payload.js';
import { replaceExtension, writeOutputFile } from './path-utils.js';
import { type CacheOptions, buildCacheHeaders, validateCacheOptions } from './cache.js';
import { detectAudioFormat, wrapPcmInWav } from './audio-utils.js';
import {
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  type ProviderRoutingOptions,
} from './provider-routing.js';

export interface TextToSpeechRequest extends CacheOptions {
  input: string;
  model?: string;
  voice?: string;
  response_format?: string;
  speed?: number;
  instructions?: string;
  save_path?: string;
  provider?: Record<string, unknown>;
}

const MIN_SPEED = 0.25;
const MAX_SPEED = 4.0;

const VALID_FORMATS = new Set<string>(TTS_RESPONSE_FORMATS);

export async function handleTextToSpeech(
  request: { params: { arguments: TextToSpeechRequest } },
  apiClient: OpenRouterAPIClient,
) {
  const args = request.params.arguments ?? ({} as TextToSpeechRequest);
  const {
    input,
    model,
    voice,
    response_format,
    speed,
    instructions,
    save_path,
    provider,
    cache,
    cache_ttl,
    cache_clear,
  } = args;

  if (typeof input !== 'string' || !input.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'input text is required.');
  }

  if (model !== undefined && typeof model !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'model must be a string.');
  }
  if (voice !== undefined && typeof voice !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'voice must be a string.');
  }

  if (response_format && !VALID_FORMATS.has(response_format)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `response_format '${response_format}' is not supported. Valid: ${[...VALID_FORMATS].join(', ')}.`,
    );
  }

  if (
    speed !== undefined &&
    (typeof speed !== 'number' || !Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED)
  ) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `speed must be a number between ${MIN_SPEED} and ${MAX_SPEED}.`,
    );
  }

  if (instructions !== undefined && typeof instructions !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'instructions must be a string.');
  }

  const cacheError = validateCacheOptions({ cache, cache_ttl, cache_clear });
  if (cacheError) return cacheError;

  const effectiveModel = model?.trim() || DEFAULT_TTS_MODEL;
  const effectiveVoice =
    voice?.trim() || (effectiveModel === DEFAULT_TTS_MODEL ? DEFAULT_TTS_VOICE : undefined);
  const effectiveResponseFormat = response_format || DEFAULT_TTS_RESPONSE_FORMAT;

  logger.audit('text_to_speech.start', {
    model: effectiveModel,
    voice: effectiveVoice || 'provider default',
    response_format: effectiveResponseFormat,
    input_preview: input.slice(0, 80),
    save_path: save_path ? 'provided' : 'none',
  });

  const savePathResult = await resolveOptionalOutputPath(save_path);
  if (isToolErrorResult(savePathResult)) return savePathResult;
  const safeSavePath = savePathResult.path;

  const body: Record<string, unknown> = {
    model: effectiveModel,
    input,
    response_format: effectiveResponseFormat,
  };
  if (effectiveVoice) body.voice = effectiveVoice;
  if (typeof speed === 'number') body.speed = speed;
  if (instructions) body.instructions = instructions;

  // Merge user-supplied provider options with OPENROUTER_PROVIDER_* env defaults.
  const mergedProvider = buildProviderBody(
    mergeProviderOptions(readProviderDefaults(), provider as ProviderRoutingOptions),
  );
  if (mergedProvider) body.provider = mergedProvider;

  const headers = buildCacheHeaders({ cache, cache_ttl, cache_clear });

  let result: { buffer: Buffer; contentType: string };
  try {
    result = await apiClient.generateSpeech(body, headers);
  } catch (err) {
    return classifyUpstreamError(err, 'text_to_speech');
  }

  const { buffer: rawBuffer, contentType } = result;

  // Guard: reject 0-byte responses — a 200 OK with no body is silent corruption.
  // Every other generation handler (generate_video, generate_image, generate_audio)
  // already rejects empty payloads; TTS was the gap.
  if (rawBuffer.length === 0) {
    return toolError(
      ErrorCode.UPSTREAM_REFUSED,
      'TTS API returned an empty audio response (0 bytes).',
      undefined,
      {
        suggestions: [
          'Retry after a brief delay',
          'Try a different model or voice',
          'Check https://status.openrouter.ai for outages',
        ],
      },
    );
  }

  // Guard: CDN / reverse-proxy error pages sometimes return 200 with text/html.
  // Without this guard the HTML body would be saved as an audio file that cannot
  // be played — silently corrupt output. Mirrors the same protection in
  // generate_video (finalizeCompletedJob) and generate_image_dedicated.
  const rawMime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (rawMime === 'text/html' || rawMime === 'application/xhtml+xml') {
    return toolError(
      ErrorCode.UPSTREAM_HTTP,
      `TTS API returned ${rawMime} instead of audio — ` +
        'likely a temporary CDN or upstream error. Retry after a brief delay.',
      undefined,
      {
        suggestions: [
          'Retry after a brief delay',
          'Check https://status.openrouter.ai for outages',
        ],
      },
    );
  }

  // Wrap raw PCM in a WAV container so the output is universally playable,
  // matching the behaviour of generate_audio (see BUG-005).
  let buffer = rawBuffer;
  const detected = detectAudioFormat(rawBuffer);
  if (detected.ext === 'pcm') {
    buffer = wrapPcmInWav(rawBuffer);
    detected.ext = 'wav';
    detected.mimeType = 'audio/wav';
  }

  const mimeType = detected.mimeType || contentType.split(';')[0]?.trim() || 'audio/mpeg';
  const ext = detected.ext;

  const baseMeta: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    model: effectiveModel,
    mime: mimeType,
    size_bytes: buffer.length,
  };
  if (effectiveVoice) baseMeta.voice = effectiveVoice;

  if (safeSavePath) {
    const currentExt = extname(safeSavePath).toLowerCase().slice(1);
    const actualPath = currentExt === ext ? safeSavePath : replaceExtension(safeSavePath, ext);
    try {
      await writeOutputFile(actualPath, buffer);
    } catch (err) {
      return toolErrorFrom(ErrorCode.INTERNAL, err, 'Write');
    }
    baseMeta.save_path = actualPath;

    return buildBinaryToolResult(
      { kind: 'audio', buffer, mimeType },
      {
        savedPath: actualPath,
        summaryText: `Speech saved to: ${actualPath}`,
        meta: baseMeta,
      },
    );
  }

  return buildBinaryToolResult(
    { kind: 'audio', buffer, mimeType },
    {
      prefixText: `Speech generated (${buffer.length} bytes, ${mimeType}).`,
      meta: baseMeta,
    },
  );
}
