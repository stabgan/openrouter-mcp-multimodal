import { promises as fs } from 'fs';
import { dirname } from 'path';
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
const DEFAULT_FORMAT = 'wav';

// Valid audio formats (common across providers)
const VALID_FORMATS = ['wav', 'mp3', 'flac', 'opus', 'pcm16'] as const;
type AudioFormat = typeof VALID_FORMATS[number];

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
      await fs.writeFile(save_path, Buffer.from(fullAudioBase64, 'base64'));
      
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
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
}
