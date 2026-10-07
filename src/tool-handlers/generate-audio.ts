import { extname } from 'node:path';
import OpenAI from 'openai';
import { GENERATE_AUDIO_FORMATS } from '../tool-definitions.js';
import { resolveOptionalOutputPath, isToolErrorResult } from './path-safety.js';
import { asOpenAIChatBody } from './chat-request.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildBinaryToolResult } from './tool-result-payload.js';
import { replaceExtension, writeOutputFile } from './path-utils.js';
import { createWavHeader, wrapPcmInWav, detectAudioFormat } from './audio-utils.js';
import { readEnvInt } from './fetch-utils.js';
import {
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  type ProviderRoutingOptions,
} from './provider-routing.js';

// Re-export WAV helpers so existing test imports from this module keep working.
export { createWavHeader, wrapPcmInWav };

export interface GenerateAudioToolRequest {
  prompt: string;
  model?: string;
  voice?: string;
  format?: string;
  save_path?: string;
  provider?: Record<string, unknown>;
}

const DEFAULT_MODEL = 'openai/gpt-audio';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_FORMAT = 'pcm16';
const DEFAULT_AUDIO_GEN_MAX_BYTES = 50 * 1024 * 1024; // 50 MiB — matches SPEECH_MAX_BYTES

function getAudioGenMaxBytes(): number {
  return readEnvInt('OPENROUTER_AUDIO_GEN_MAX_BYTES', DEFAULT_AUDIO_GEN_MAX_BYTES, 1024);
}

const VALID_FORMATS = GENERATE_AUDIO_FORMATS;
type OutputFormat = (typeof VALID_FORMATS)[number];

/** Decode each streamed base64 fragment and concatenate binary (joining strings corrupts padding). */
export function assembleBase64AudioChunks(chunks: string[]): Buffer {
  if (chunks.length === 0) return Buffer.alloc(0);
  if (chunks.length === 1) return Buffer.from(chunks[0]!, 'base64');
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, 'base64')));
}

export async function handleGenerateAudio(
  request: { params: { arguments: GenerateAudioToolRequest } },
  openai: OpenAI,
) {
  const { prompt, model, voice, format, save_path, provider } = request.params.arguments ?? {
    prompt: '',
  };

  if (typeof prompt !== 'string' || !prompt.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'prompt is required.');
  }

  if (format && !(VALID_FORMATS as readonly string[]).includes(format)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `format '${format}' is not supported. Valid: ${VALID_FORMATS.join(', ')}.`,
    );
  }

  logger.audit('generate_audio.start', {
    model: model?.trim() || DEFAULT_MODEL,
    voice: voice?.trim() || DEFAULT_VOICE,
    format: format || DEFAULT_FORMAT,
    prompt_preview: prompt.slice(0, 80),
    save_path: save_path ? 'provided' : 'none',
  });

  const savePathResult = await resolveOptionalOutputPath(save_path);
  if (isToolErrorResult(savePathResult)) return savePathResult;
  const safeBase = savePathResult.path;

  const selectedFormat: OutputFormat = (VALID_FORMATS as readonly string[]).includes(format ?? '')
    ? (format as OutputFormat)
    : DEFAULT_FORMAT;
  const selectedVoice = voice?.trim() || DEFAULT_VOICE;

  let stream: AsyncIterable<Record<string, unknown>>;
  try {
    const body: Record<string, unknown> = {
      model: model?.trim() || DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['text', 'audio'],
      audio: { voice: selectedVoice, format: selectedFormat },
      stream: true,
    };

    // Merge user-supplied provider options with OPENROUTER_PROVIDER_* env defaults.
    const mergedProvider = buildProviderBody(
      mergeProviderOptions(readProviderDefaults(), provider as ProviderRoutingOptions),
    );
    if (mergedProvider) body.provider = mergedProvider;

    stream = (await openai.chat.completions.create(
      asOpenAIChatBody(body),
    )) as unknown as AsyncIterable<Record<string, unknown>>;
  } catch (err) {
    return classifyUpstreamError(err, 'generate_audio');
  }

  try {
    const audioChunks: string[] = [];
    const transcriptChunks: string[] = [];
    let approxRawBytes = 0;
    const maxBytes = getAudioGenMaxBytes();
    let finishReason: string | undefined;
    let streamUsage: Record<string, unknown> | undefined;

    for await (const chunk of stream) {
      const typedChunk = chunk as {
        choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }>;
        usage?: Record<string, unknown>;
      };

      // Extract finish_reason and usage from the final chunk — mirrors
      // how chat_completion, analyze_image, analyze_audio, and analyze_video
      // surface this metadata. Without this, callers cannot tell if audio
      // was truncated (finish_reason=length) or content-filtered.
      const choice = typedChunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (typedChunk.usage) streamUsage = typedChunk.usage;

      const delta = choice?.delta;
      if (delta && typeof delta === 'object' && delta.audio) {
        const a = delta.audio as { data?: unknown; transcript?: unknown };
        if (typeof a.data === 'string') {
          approxRawBytes += Math.ceil((a.data.length * 3) / 4);
          if (approxRawBytes > maxBytes) {
            return toolError(
              ErrorCode.RESOURCE_TOO_LARGE,
              `Streaming audio exceeded ${maxBytes} bytes. ` +
                'Raise OPENROUTER_AUDIO_GEN_MAX_BYTES or shorten the prompt.',
            );
          }
          audioChunks.push(a.data);
        }
        if (typeof a.transcript === 'string') transcriptChunks.push(a.transcript);
      }
    }

    const transcript = transcriptChunks.join('');

    if (audioChunks.length === 0) {
      // Surface finish_reason so callers know *why* no audio was returned.
      // content_filter is the most common non-obvious case.
      const isContentFiltered = finishReason === 'content_filter';
      const reasonHint = finishReason ? ` (finish_reason: ${finishReason})` : '';
      return toolError(
        isContentFiltered ? ErrorCode.UPSTREAM_REFUSED : ErrorCode.UPSTREAM_REFUSED,
        transcript
          ? `No audio returned${reasonHint} (model emitted transcript only): ${transcript.slice(0, 300)}`
          : `No audio returned${reasonHint}.`,
        {
          reason: isContentFiltered ? 'content_filter' : 'no_audio_in_stream',
          ...(finishReason ? { finish_reason: finishReason } : {}),
        },
        {
          suggestions: isContentFiltered
            ? ['Rephrase the prompt — the model content filter blocked the request']
            : [
                'Try a different model — not all models support audio generation',
                'Try a different voice',
                'Simplify or rephrase the prompt',
              ],
        },
      );
    }

    let audioBuffer = assembleBase64AudioChunks(audioChunks);
    const detected = detectAudioFormat(audioBuffer);

    if (detected.ext === 'pcm') {
      audioBuffer = wrapPcmInWav(audioBuffer);
      detected.ext = 'wav';
      detected.mimeType = 'audio/wav';
    }

    // Build _meta with finish_reason, model, and usage — consistent with
    // every other completion-based handler (chat_completion, analyze_image,
    // analyze_audio, analyze_video, async_chat).
    const baseMeta: Record<string, unknown> = {
      server_version: SERVER_VERSION,
      model: model?.trim() || DEFAULT_MODEL,
    };
    if (finishReason) baseMeta.finish_reason = finishReason;
    if (streamUsage) baseMeta.usage = streamUsage;

    if (safeBase) {
      const fileExt = extname(safeBase).toLowerCase().slice(1);
      const actualSavePath =
        fileExt === detected.ext ? safeBase : replaceExtension(safeBase, detected.ext);

      try {
        await writeOutputFile(actualSavePath, audioBuffer);
      } catch (err) {
        return toolErrorFrom(ErrorCode.INTERNAL, err, 'Write');
      }

      const formatNote =
        actualSavePath !== safeBase
          ? ` (detected ${detected.ext.toUpperCase()}, saved as ${actualSavePath})`
          : '';
      const result = transcript
        ? `Audio saved to: ${actualSavePath}${formatNote}\nTranscript: ${transcript}`
        : `Audio saved to: ${actualSavePath}${formatNote}`;

      return buildBinaryToolResult(
        { kind: 'audio', buffer: audioBuffer, mimeType: detected.mimeType },
        {
          savedPath: actualSavePath,
          summaryText: result,
          meta: baseMeta,
        },
      );
    }

    return buildBinaryToolResult(
      { kind: 'audio', buffer: audioBuffer, mimeType: detected.mimeType },
      {
        prefixText: transcript || 'Audio generated successfully.',
        meta: baseMeta,
      },
    );
  } catch (err) {
    return classifyUpstreamError(err, 'generate_audio (stream)');
  }
}
