import { extname } from 'node:path';
import OpenAI from 'openai';
import { GENERATE_AUDIO_FORMATS } from '../tool-definitions.js';
import { resolveOptionalOutputPath, isToolErrorResult } from './path-safety.js';
import { asOpenAIChatBody } from './chat-request.js';
import { ErrorCode, toolError } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildBinaryToolResult } from './tool-result-payload.js';
import { replaceExtension, writeOutputFile } from './path-utils.js';
import { detectAudioFormat } from './audio-utils.js';

export { detectAudioFormat } from './audio-utils.js';

export interface GenerateAudioToolRequest {
  prompt: string;
  model?: string;
  voice?: string;
  format?: string;
  save_path?: string;
}

const DEFAULT_MODEL = 'openai/gpt-audio';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_FORMAT = 'pcm16';

const VALID_FORMATS = GENERATE_AUDIO_FORMATS;
type OutputFormat = (typeof VALID_FORMATS)[number];

const DEFAULT_PCM_SAMPLE_RATE = 24000;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_NUM_CHANNELS = 1;

/** Create a 44-byte WAV header for raw PCM16 data at `sampleRate` Hz. */
export function createWavHeader(
  dataLength: number,
  sampleRate: number = DEFAULT_PCM_SAMPLE_RATE,
): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * PCM_NUM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const blockAlign = PCM_NUM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(PCM_NUM_CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

export function wrapPcmInWav(
  pcmData: Buffer,
  sampleRate: number = DEFAULT_PCM_SAMPLE_RATE,
): Buffer {
  return Buffer.concat([createWavHeader(pcmData.length, sampleRate), pcmData]);
}

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
  const { prompt, model, voice, format, save_path } = request.params.arguments ?? {
    prompt: '',
  };

  if (!prompt?.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'prompt is required.');
  }

  if (format && !(VALID_FORMATS as readonly string[]).includes(format)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `format '${format}' is not supported. Valid: ${VALID_FORMATS.join(', ')}.`,
    );
  }

  logger.audit('generate_audio.start', {
    model: model || DEFAULT_MODEL,
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
    stream = (await openai.chat.completions.create(
      asOpenAIChatBody({
        model: model || DEFAULT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['text', 'audio'],
        audio: { voice: selectedVoice, format: selectedFormat },
        stream: true,
      }),
    )) as unknown as AsyncIterable<Record<string, unknown>>;
  } catch (err) {
    return classifyUpstreamError(err, 'generate_audio');
  }

  try {
    const audioChunks: string[] = [];
    const transcriptChunks: string[] = [];

    for await (const chunk of stream) {
      const delta = (chunk as { choices?: Array<{ delta?: Record<string, unknown> }> }).choices?.[0]
        ?.delta;
      if (delta && typeof delta === 'object' && delta.audio) {
        const a = delta.audio as { data?: unknown; transcript?: unknown };
        if (typeof a.data === 'string') audioChunks.push(a.data);
        if (typeof a.transcript === 'string') transcriptChunks.push(a.transcript);
      }
    }

    const transcript = transcriptChunks.join('');

    if (audioChunks.length === 0) {
      return toolError(
        ErrorCode.INTERNAL,
        transcript
          ? `No audio returned (model emitted transcript only): ${transcript.slice(0, 300)}`
          : 'No audio returned.',
        { reason: 'no_audio_in_stream' },
      );
    }

    let audioBuffer = assembleBase64AudioChunks(audioChunks);
    const detected = detectAudioFormat(audioBuffer);

    if (detected.ext === 'pcm') {
      audioBuffer = wrapPcmInWav(audioBuffer);
      detected.ext = 'wav';
      detected.mimeType = 'audio/wav';
    }

    if (safeBase) {
      const fileExt = extname(safeBase).toLowerCase().slice(1);
      const actualSavePath =
        fileExt === detected.ext ? safeBase : replaceExtension(safeBase, detected.ext);

      await writeOutputFile(actualSavePath, audioBuffer);

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
          meta: {
            server_version: SERVER_VERSION,
          },
        },
      );
    }

    return buildBinaryToolResult(
      { kind: 'audio', buffer: audioBuffer, mimeType: detected.mimeType },
      {
        prefixText: transcript || 'Audio generated successfully.',
        meta: {
          server_version: SERVER_VERSION,
        },
      },
    );
  } catch (err) {
    return classifyUpstreamError(err, 'generate_audio (stream)');
  }
}
