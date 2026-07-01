import { promises as fs } from 'fs';
import path from 'node:path';
import OpenAI from 'openai';
import { resolveSafeInputPath } from './path-safety.js';
import { mimeFromExtension } from './image-utils.js';

export async function resolveInputImage(ref: string): Promise<string> {
  const trimmed = ref.trim();
  if (!trimmed) throw new Error('empty input_images entry');

  if (trimmed.startsWith('data:')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const abs = await resolveSafeInputPath(trimmed);
  const buf = await fs.readFile(abs);
  const mime = mimeFromExtension(path.extname(abs)) || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

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

  const urls = await Promise.all(inputImages.map((ref) => resolveInputImage(ref)));
  for (const url of urls) {
    parts.push({
      type: 'image_url',
      image_url: { url, detail: 'high' },
    });
  }

  return parts;
}
