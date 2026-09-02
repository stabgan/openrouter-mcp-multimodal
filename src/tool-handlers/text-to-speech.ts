/** Dedicated POST /api/v1/audio/speech — OpenAI, Gemini Flash TTS, Voxtral. */
import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { resolveOptionalOutputPath, isToolErrorResult } from './path-safety.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildBinaryToolResult } from './tool-result-payload.js';
import { replaceExtension } from './path-utils.js';
import { type CacheOptions, buildCacheHeaders } from './cache.js';

export interface TextToSpeechRequest extends CacheOptions {
  input: string;
  model?: string;
  voice?: string;
  response_format?: string;
  speed?: number;
  instructions?: string;
  save_path?: string;
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini-tts-2025-12-15';
const DEFAULT_VOICE = 'alloy';

const VALID_FORMATS = new Set(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']);

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
    cache,
    cache_ttl,
    cache_clear,
  } = args;

  if (!input?.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'input text is required.');
  }

  if (response_format && !VALID_FORMATS.has(response_format)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `response_format '${response_format}' is not supported. Valid: ${[...VALID_FORMATS].join(', ')}.`,
    );
  }

  logger.audit('text_to_speech.start', {
    model: model || DEFAULT_MODEL,
    voice: voice || DEFAULT_VOICE,
    response_format: response_format || 'mp3',
    input_preview: input.slice(0, 80),
    save_path: save_path ? 'provided' : 'none',
  });

  const savePathResult = await resolveOptionalOutputPath(save_path);
  if (isToolErrorResult(savePathResult)) return savePathResult;
  const safeSavePath = savePathResult.path;

  const body: Record<string, unknown> = {
    model: model || DEFAULT_MODEL,
    input,
    voice: voice || DEFAULT_VOICE,
  };
  if (response_format) body.response_format = response_format;
  if (typeof speed === 'number' && speed > 0) body.speed = speed;
  if (instructions) body.instructions = instructions;

  const headers = buildCacheHeaders({ cache, cache_ttl, cache_clear });

  let result: { buffer: Buffer; contentType: string };
  try {
    result = await apiClient.generateSpeech(body, headers);
  } catch (err) {
    return classifyUpstreamError(err, 'text_to_speech');
  }

  const { buffer, contentType } = result;
  const mimeType = contentType.split(';')[0]?.trim() || 'audio/mpeg';

  const ext = response_format || 'mp3';

  const baseMeta: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    model: model || DEFAULT_MODEL,
    mime: mimeType,
    size_bytes: buffer.length,
    voice: voice || DEFAULT_VOICE,
  };

  if (safeSavePath) {
    const currentExt = extname(safeSavePath).toLowerCase().slice(1);
    const actualPath = currentExt === ext ? safeSavePath : replaceExtension(safeSavePath, ext);
    try {
      await fs.writeFile(actualPath, buffer);
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
