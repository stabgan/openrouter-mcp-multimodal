import { promises as fs } from 'fs';
import { dirname, extname } from 'path';
import OpenAI from 'openai';

export interface GenerateAudioToolRequest {
  prompt: string;
  model?: string;
  voice?: string;
  format?: string;
  save_path?: string;
}

// Default model with audio output support
const DEFAULT_MODEL = 'openai/gpt-audio';
const DEFAULT_VOICE = 'alloy';
const DEFAULT_FORMAT = 'pcm16'; // pcm16 is the safe default; detection handles wrapping in WAV

// Valid audio formats for output (note: streaming only supports pcm16)
const VALID_FORMATS = ['wav', 'mp3', 'flac', 'opus', 'pcm16'] as const;
type AudioFormat = typeof VALID_FORMATS[number];

// PCM16 audio parameters (OpenAI defaults)
const PCM_SAMPLE_RATE = 24000;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_NUM_CHANNELS = 1;

interface AudioDelta {
  data?: string;
  transcript?: string;
}

interface StreamChunk {
  choices: Array<{
    delta: {
      audio?: AudioDelta;
    };
  }>;
}

/**
 * Create a WAV file header for PCM16 audio data
 */
function createWavHeader(dataLength: number, sampleRate: number = PCM_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  const numChannels = PCM_NUM_CHANNELS;
  const bitsPerSample = PCM_BITS_PER_SAMPLE;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  // RIFF chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4); // File size - 8
  header.write('WAVE', 8);

  // fmt sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Sub-chunk size (16 for PCM)
  header.writeUInt16LE(1, 20); // Audio format (1 = PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

/**
 * Detect audio format from the raw binary data
 * Returns the detected format extension and mime type
 */
function detectAudioFormat(data: Buffer): { ext: string; mimeType: string } {
  // Check for MP3 (ID3 tag or MP3 frame sync)
  if (data.length >= 3) {
    // ID3v2 tag starts with 'ID3'
    if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
      return { ext: 'mp3', mimeType: 'audio/mpeg' };
    }
    // MP3 frame sync (0xFF 0xFB or 0xFF 0xFA or 0xFF 0xF3 or 0xFF 0xF2)
    if (data[0] === 0xFF && (data[1] & 0xE0) === 0xE0) {
      return { ext: 'mp3', mimeType: 'audio/mpeg' };
    }
  }
  // Check for WAV (RIFF header)
  if (data.length >= 12 && data.slice(0, 4).toString() === 'RIFF' && data.slice(8, 12).toString() === 'WAVE') {
    return { ext: 'wav', mimeType: 'audio/wav' };
  }
  // Check for FLAC (fLaC magic number)
  if (data.length >= 4 && data.slice(0, 4).toString() === 'fLaC') {
    return { ext: 'flac', mimeType: 'audio/flac' };
  }
  // Check for OGG (OggS magic number)
  if (data.length >= 4 && data.slice(0, 4).toString() === 'OggS') {
    return { ext: 'ogg', mimeType: 'audio/ogg' };
  }
  // Default to PCM16 (raw audio)
  return { ext: 'pcm', mimeType: 'audio/pcm16' };
}

/**
 * Wrap PCM16 audio data in a WAV container
 */
function wrapPcmInWav(pcmData: Buffer): Buffer {
  const wavHeader = createWavHeader(pcmData.length);
  return Buffer.concat([wavHeader, pcmData]);
}

export async function handleGenerateAudio(
  request: { params: { arguments: GenerateAudioToolRequest } },
  openai: OpenAI,
) {
  const { prompt, model, voice, format, save_path } = request.params.arguments;

  if (!prompt?.trim()) {
    return { content: [{ type: 'text', text: 'Prompt is required.' }], isError: true };
  }

  // Validate format only; voice is provider-specific
  const selectedFormat: AudioFormat = VALID_FORMATS.includes(format as AudioFormat) ? (format as AudioFormat) : DEFAULT_FORMAT;
  const selectedVoice = voice?.trim() || DEFAULT_VOICE;

  try {
    // Audio output requires streaming - use type assertion for OpenRouter-specific params
    // OpenRouter returns audio chunks via SSE when stream: true
    const stream = await openai.chat.completions.create({
      model: model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['text', 'audio'],
      audio: {
        voice: selectedVoice,
        format: selectedFormat,
      },
      stream: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const audioChunks: string[] = [];
    const transcriptChunks: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const chunk of stream as any) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.audio) {
        if (delta.audio.data) {
          audioChunks.push(delta.audio.data);
        }
        if (delta.audio.transcript) {
          transcriptChunks.push(delta.audio.transcript);
        }
      }
    }

    const fullAudioBase64 = audioChunks.join('');
    const transcript = transcriptChunks.join('');

    if (!fullAudioBase64) {
      const msg = transcript || 'No audio generated.';
      return { content: [{ type: 'text', text: msg }] };
    }

    // Save to file if path provided
    if (save_path) {
      const dir = dirname(save_path);
      await fs.mkdir(dir, { recursive: true });
      
      // Decode audio data and detect actual format from magic bytes
      const audioBuffer = Buffer.from(fullAudioBase64, 'base64');
      const detected = detectAudioFormat(audioBuffer);
      
      let audioData: Buffer;
      let actualSavePath = save_path;
      
      if (detected.ext === 'pcm') {
        // Raw PCM data - wrap in WAV header so it's playable
        audioData = wrapPcmInWav(audioBuffer);
        // Correct extension to .wav if not already
        if (!actualSavePath.toLowerCase().endsWith('.wav')) {
          actualSavePath = actualSavePath.replace(/\.[^.]+$/, '') + '.wav';
        }
      } else {
        // Already a complete container format (WAV, MP3, FLAC, OGG) - save as-is
        audioData = audioBuffer;
        // Auto-correct extension to match detected format
        const fileExt = extname(actualSavePath).toLowerCase().slice(1);
        if (fileExt !== detected.ext && fileExt !== '' ) {
          actualSavePath = actualSavePath.replace(/\.[^.]+$/, '') + '.' + detected.ext;
        }
      }
      
      await fs.writeFile(actualSavePath, audioData);
      
      const formatNote = actualSavePath !== save_path
        ? ` (detected ${detected.ext.toUpperCase()}, saved as ${actualSavePath})`
        : '';
      const result = transcript
        ? `Audio saved to: ${actualSavePath}${formatNote}\nTranscript: ${transcript}`
        : `Audio saved to: ${actualSavePath}${formatNote}`;
      
      return {
        content: [
          { type: 'text', text: result },
          { type: 'audio', mimeType: detected.mimeType, data: fullAudioBase64 },
        ],
      };
    }

    // Return audio data URL - detect mime type from actual data
    const audioBuffer = Buffer.from(fullAudioBase64, 'base64');
    const detected = detectAudioFormat(audioBuffer);
    return {
      content: [
        { type: 'text', text: transcript || 'Audio generated successfully.' },
        { type: 'audio', mimeType: detected.mimeType, data: fullAudioBase64 },
      ],
    };
  } catch (error: unknown) {
    // Extract full error details from OpenAI SDK error
    let msg: string;
    if (error instanceof Error) {
      msg = error.message;
      // Try to get more details from OpenAI error structure
      const openaiError = error as Error & { status?: number; error?: { message?: string } };
      if (openaiError.error?.message) {
        msg = `${msg} - ${openaiError.error.message}`;
      }
    } else {
      msg = String(error);
    }
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
}
