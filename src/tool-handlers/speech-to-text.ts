/**
 * speech_to_text — uses OpenRouter's dedicated POST /api/v1/audio/transcriptions
 * endpoint (launched May 2026) for speech-to-text transcription. Faster and more
 * cost-efficient than routing through chat completions for pure transcription.
 *
 * Supported models: OpenAI Whisper-1, GPT-4o Transcribe, GPT-4o Mini Transcribe,
 * Mistral Voxtral Mini Transcribe.
 */
import { promises as fs } from 'fs';
import path from 'node:path';
import type { OpenRouterAPIClient, TranscriptionResponse } from '../openrouter-api.js';
import { resolveSafeInputPath, UnsafeOutputPathError } from './path-safety.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { type CacheOptions, buildCacheHeaders } from './cache.js';

export interface SpeechToTextRequest extends CacheOptions {
  audio_path: string;
  model?: string;
  language?: string;
  response_format?: string;
  temperature?: number;
}

const DEFAULT_MODEL = 'openai/whisper-1';

const VALID_RESPONSE_FORMATS = new Set(['json', 'text', 'srt', 'verbose_json', 'vtt']);

/** Infer audio format from file extension. */
function audioFormatFromExt(ext: string): string {
  const normalized = ext.toLowerCase().replace('.', '');
  switch (normalized) {
    case 'mp3': return 'mp3';
    case 'mp4': case 'm4a': return 'mp4';
    case 'wav': return 'wav';
    case 'flac': return 'flac';
    case 'ogg': case 'oga': return 'ogg';
    case 'webm': return 'webm';
    case 'opus': return 'opus';
    default: return 'mp3';
  }
}

/**
 * Resolve audio input to base64 + format, supporting:
 * - data: URLs (pass through)
 * - http(s) URLs (fetch)
 * - local file paths (sandboxed read)
 */
async function resolveAudioInput(
  audioPath: string,
): Promise<{ data: string; format: string }> {
  const trimmed = audioPath.trim();
  if (!trimmed) throw new Error('audio_path is empty');

  // Data URL
  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(/^data:audio\/([^;,]+)(?:;[^,]*)*;base64,(.+)$/);
    if (!match) throw new Error('Invalid audio data URL format');
    return { data: match[2]!, format: match[1]! };
  }

  // HTTP URL
  if (/^https?:\/\//i.test(trimmed)) {
    const { fetchHttpResource } = await import('./fetch-utils.js');
    const { buffer, contentType } = await fetchHttpResource(trimmed, {
      timeoutMs: 60_000,
      maxBytes: 100 * 1024 * 1024,
      maxRedirects: 8,
    });
    const format = contentType?.match(/audio\/(\w+)/)?.[1] || 'mp3';
    return { data: buffer.toString('base64'), format };
  }

  // Local file
  const abs = await resolveSafeInputPath(trimmed);
  const buf = await fs.readFile(abs);
  const ext = path.extname(abs);
  const format = audioFormatFromExt(ext);
  return { data: buf.toString('base64'), format };
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

  logger.audit('speech_to_text.start', {
    model: model || DEFAULT_MODEL,
    audio_path: audio_path.startsWith('data:') ? 'data_url' : audio_path.slice(0, 80),
    language,
    response_format,
  });

  // Resolve audio input
  let audioInput: { data: string; format: string };
  try {
    audioInput = await resolveAudioInput(audio_path);
  } catch (err) {
    if (err instanceof UnsafeOutputPathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Blocked host')) return toolErrorFrom(ErrorCode.UPSTREAM_REFUSED, err);
    return toolErrorFrom(ErrorCode.INVALID_INPUT, err);
  }

  // Build request body
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

  const text = response.text;
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
