import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { prepareAudioData } from './audio-utils.js';

// Default model with audio input support
const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export interface AnalyzeAudioToolRequest {
  audio_path: string;
  question?: string;
  model?: string;
}

export async function handleAnalyzeAudio(
  request: { params: { arguments: AnalyzeAudioToolRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const { audio_path, question, model } = request.params.arguments;

  if (!audio_path) {
    return { content: [{ type: 'text', text: 'audio_path is required.' }], isError: true };
  }

  try {
    const audioData = await prepareAudioData(audio_path);

    const completion = await openai.chat.completions.create({
      model: model || defaultModel || DEFAULT_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: question || 'Please transcribe and analyze this audio file.' },
            {
              type: 'input_audio',
              input_audio: {
                data: audioData.data,
                format: audioData.format,
              },
            },
          ],
        },
      ] as ChatCompletionMessageParam[],
    });

    return { content: [{ type: 'text', text: completion.choices[0].message.content || '' }] };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
}
