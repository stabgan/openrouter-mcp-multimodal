import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { prepareImageUrl } from './image-utils.js';

const DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

export interface AnalyzeImageToolRequest {
  image_path: string;
  question?: string;
  model?: string;
}

export async function handleAnalyzeImage(
  request: { params: { arguments: AnalyzeImageToolRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const { image_path, question, model } = request.params.arguments;

  if (!image_path) {
    return { content: [{ type: 'text', text: 'image_path is required.' }], isError: true };
  }

  try {
    const imageUrl = await prepareImageUrl(image_path);

    const completion = await openai.chat.completions.create({
      model: model || defaultModel || DEFAULT_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: question || "What's in this image?" },
            { type: 'image_url', image_url: { url: imageUrl } },
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
