import { promises as fs } from 'fs';
import { extname } from 'path';
import OpenAI from 'openai';
import { resolveSafeOutputPath, UnsafeOutputPathError } from './path-safety.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';

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

const VALID_FORMATS = ['wav', 'mp3', 'flac', 'opus', 'pcm16'] as const;
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

/**
 * Detect audio container format from magic bytes. Uses `Buffer.subarray()`
 * (not deprecated `slice()`). MP3 detection is intentionally strict:
 * - Accept ID3v2 tags (`'ID3'`) as unambiguous MP3.
 * - Accept raw frame sync only when every MPEG header field falls in a
 *   non-reserved range: version != 0b01, layer != 0b00, bitrate != 0b1111,
 *   sample rate index != 0b11. This removes the false positives that a
 *   sync-word-only check produces on random binary.
 */
export function detectAudioFormat(data: Buffer): { ext: string; mimeType: string } {
  if (data.length >= 3 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
    return { ext: 'mp3', mimeType: 'audio/mpeg' };
  }
  if (data.length >= 4 && data[0] === 0xff && (data[1]! & 0xe0) === 0xe0) {
    const b1 = data[1]!;
    const b2 = data[2]!;
    const versionBits = (b1 >> 3) & 0x03; // 01 = reserved
    const layerBits = (b1 >> 1) & 0x03; // 00 = reserved
    const bitrateIndex = (b2 >> 4) & 0x0f; // 1111 = bad
    const sampleRateIndex = (b2 >> 2) & 0x03; // 11 = reserved
    if (
      versionBits !== 0x01 &&
      layerBits !== 0x00 &&
      bitrateIndex !== 0x0f &&
      sampleRateIndex !== 0x03
    ) {
      return { ext: 'mp3', mimeType: 'audio/mpeg' };
    }
  }
  if (data.length >= 12) {
    const riff = data.subarray(0, 4).toString('ascii');
    const wave = data.subarray(8, 12).toString('ascii');
    if (riff === 'RIFF' && wave === 'WAVE') {
      return { ext: 'wav', mimeType: 'audio/wav' };
    }
  }
  if (data.length >= 4) {
    const magic = data.subarray(0, 4).toString('ascii');
    if (magic === 'fLaC') return { ext: 'flac', mimeType: 'audio/flac' };
    if (magic === 'OggS') return { ext: 'ogg', mimeType: 'audio/ogg' };
  }
  return { ext: 'pcm', mimeType: 'audio/pcm' };
}

export function wrapPcmInWav(
  pcmData: Buffer,
  sampleRate: number = DEFAULT_PCM_SAMPLE_RATE,
): Buffer {
  return Buffer.concat([createWavHeader(pcmData.length, sampleRate), pcmData]);
}

/** Strip existing extension (if any) and append a new one. */
export function replaceExtension(filePath: string, newExt: string): string {
  const current = extname(filePath);
  const base = current ? filePath.slice(0, -current.length) : filePath;
  return `${base}.${newExt}`;
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

  // Audit entry. See generate_image for rationale.
  logger.audit('generate_audio.start', {
    model: model || DEFAULT_MODEL,
    voice: voice?.trim() || DEFAULT_VOICE,
    format: (VALID_FORMATS as readonly string[]).includes(format ?? '')
      ? format
      : DEFAULT_FORMAT,
    prompt_preview: prompt.slice(0, 80),
    save_path: save_path ? 'provided' : 'none',
  });

  // Fail-fast on unsafe paths BEFORE spending tokens.
  let safeBase: string | null = null;
  if (save_path) {
    try {
      safeBase = await resolveSafeOutputPath(save_path);
    } catch (e) {
      if (e instanceof UnsafeOutputPathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, e);
      return toolErrorFrom(ErrorCode.INTERNAL, e);
    }
  }

  const selectedFormat: OutputFormat = (VALID_FORMATS as readonly string[]).includes(format ?? '')
    ? (format as OutputFormat)
    : DEFAULT_FORMAT;
  const selectedVoice = voice?.trim() || DEFAULT_VOICE;

  let stream: AsyncIterable<Record<string, unknown>>;
  try {
    stream = (await openai.chat.completions.create({
      model: model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['text', 'audio'],
      audio: { voice: selectedVoice, format: selectedFormat },
      stream: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as unknown as AsyncIterable<Record<string, unknown>>;
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

    const fullAudioBase64 = audioChunks.join('');
    const transcript = transcriptChunks.join('');

    if (!fullAudioBase64) {
      return toolError(
        ErrorCode.INTERNAL,
        transcript
          ? `No audio returned (model emitted transcript only): ${transcript.slice(0, 300)}`
          : 'No audio returned.',
        { reason: 'no_audio_in_stream' },
      );
    }

    let audioBuffer = Buffer.from(fullAudioBase64, 'base64');
    const detected = detectAudioFormat(audioBuffer);

    // Always wrap raw PCM in WAV so it's playable
    if (detected.ext === 'pcm') {
      audioBuffer = wrapPcmInWav(audioBuffer);
      detected.ext = 'wav';
      detected.mimeType = 'audio/wav';
    }

    const returnBase64 = audioBuffer.toString('base64');

    if (safeBase) {
      const fileExt = extname(safeBase).toLowerCase().slice(1);
      const actualSavePath =
        fileExt === detected.ext ? safeBase : replaceExtension(safeBase, detected.ext);

      await fs.writeFile(actualSavePath, audioBuffer);

      const formatNote =
        actualSavePath !== safeBase
          ? ` (detected ${detected.ext.toUpperCase()}, saved as ${actualSavePath})`
          : '';
      const result = transcript
        ? `Audio saved to: ${actualSavePath}${formatNote}\nTranscript: ${transcript}`
        : `Audio saved to: ${actualSavePath}${formatNote}`;

      return {
        content: [
          { type: 'text' as const, text: result },
          { type: 'audio' as const, mimeType: detected.mimeType, data: returnBase64 },
        ],
        _meta: {
          server_version: SERVER_VERSION,
          save_path: actualSavePath,
          mime: detected.mimeType,
          size_bytes: audioBuffer.length,
        },
      };
    }

    return {
      content: [
        { type: 'text' as const, text: transcript || 'Audio generated successfully.' },
        { type: 'audio' as const, mimeType: detected.mimeType, data: returnBase64 },
      ],
      _meta: {
        server_version: SERVER_VERSION,
        mime: detected.mimeType,
        size_bytes: audioBuffer.length,
      },
    };
  } catch (err) {
    return classifyUpstreamError(err, 'generate_audio (stream)');
  }
}
