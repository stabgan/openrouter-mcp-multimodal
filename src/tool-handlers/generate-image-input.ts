import OpenAI from 'openai';
import { resolveImageUrl } from './image-source.js';

export async function buildUserContent(
  prompt: string,
  inputImages?: string[],
): Promise<string | OpenAI.Chat.Completions.ChatCompletionContentPart[]> {
  if (!inputImages?.length) {
    return `Generate an image: ${prompt}`;
  }

  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: 'text',
      text:
        `Generate an image based on this prompt, using the following reference image(s) ` +
        `for visual consistency. Match the appearance, identity, and style of the references ` +
        `closely; do not alter them.\n\nPrompt: ${prompt}`,
    },
  ];

  const urls = await Promise.all(inputImages.map((ref) => resolveImageUrl(ref)));
  for (const url of urls) {
    parts.push({
      type: 'image_url',
      image_url: { url, detail: 'high' },
    });
  }

  return parts;
}
