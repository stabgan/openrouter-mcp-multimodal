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
const DEFAULT_FORMAT = 'pcm16'; // pcm16 is required for streaming audio output

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
      
      // Decode PCM16 audio data
      const pcmData = Buffer.from(fullAudioBase64, 'base64');
      
      // If saving as .wav, wrap PCM data in WAV container
      const fileExt = extname(save_path).toLowerCase();
      const audioData = fileExt === '.wav' ? wrapPcmInWav(pcmData) : pcmData;
      
      await fs.writeFile(save_path, audioData);
      
      const result = transcript
        ? `Audio saved to: ${save_path}\nTranscript: ${transcript}`
        : `Audio saved to: ${save_path}`;
      
      return {
        content: [
          { type: 'text', text: result },
          { type: 'audio', mimeType: `audio/${selectedFormat}`, data: fullAudioBase64 },
        ],
      };
    }

    // Return audio data URL
    const mimeType = `audio/${selectedFormat}`;
    return {
      content: [
        { type: 'text', text: transcript || 'Audio generated successfully.' },
        { type: 'audio', mimeType, data: fullAudioBase64 },
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
