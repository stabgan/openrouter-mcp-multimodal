import { promises as fs } from 'fs';
import { dirname } from 'path';
import OpenAI from 'openai';

export interface GenerateImageToolRequest {
  prompt: string;
  model?: string;
  save_path?: string;
}

const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';

export async function handleGenerateImage(
  request: { params: { arguments: GenerateImageToolRequest } },
  openai: OpenAI,
) {
  const { prompt, model, save_path } = request.params.arguments;

  if (!prompt?.trim()) {
    return { content: [{ type: 'text', text: 'Prompt is required.' }], isError: true };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: `Generate an image: ${prompt}` }],
    });

    const message = completion.choices[0]?.message;
    if (!message) {
      return { content: [{ type: 'text', text: 'No response from model.' }], isError: true };
    }

    const base64 = extractBase64(message as unknown as Record<string, unknown>);
    if (base64) {
      if (save_path) {
        const dir = dirname(save_path);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(save_path, Buffer.from(base64.data, 'base64'));
        return {
          content: [
            { type: 'text', text: `Image saved to: ${save_path}` },
            { type: 'image', mimeType: base64.mime, data: base64.data },
          ],
        };
      }
      return { content: [{ type: 'image', mimeType: base64.mime, data: base64.data }] };
    }

    const content = message.content;
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    return { content: [{ type: 'text', text }] };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
}

function extractBase64(message: Record<string, unknown>): { data: string; mime: string } | null {
  const images = message.images;
  if (Array.isArray(images) && images.length) {
    for (const img of images as Record<string, unknown>[]) {
      const imageUrl = img.image_url as { url?: string } | undefined;
      const result = parseDataUrl((imageUrl?.url as string) || (img.url as string | undefined));
      if (result) return result;
    }
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content as Record<string, unknown>[]) {
      const iu = part.image_url as { url?: string } | undefined;
      const url = iu?.url || (part.url as string | undefined);
      if (url) {
        const r = parseDataUrl(url);
        if (r) return r;
      }
      const inline = part.inline_data as { data?: string; mime_type?: string } | undefined;
      if (inline?.data) {
        return { data: inline.data, mime: inline.mime_type || 'image/png' };
      }
      if (part.type === 'image' && typeof part.data === 'string') {
        return { data: part.data, mime: (part.mime_type as string) || 'image/png' };
      }
    }
  }

  if (typeof message.content === 'string') {
    const match = message.content.match(/data:image\/([^;]+);base64,([A-Za-z0-9+/=]+)/);
    if (match) return { data: match[2], mime: `image/${match[1]}` };
  }

  return null;
}

function parseDataUrl(url?: string): { data: string; mime: string } | null {
  if (!url?.startsWith('data:')) return null;
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  return match ? { data: match[2], mime: match[1] } : null;
}
