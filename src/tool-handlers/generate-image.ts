import { promises as fs } from 'fs';
import { dirname } from 'path';

export interface GenerateImageToolRequest {
  prompt: string;
  model?: string;
  save_path?: string;
}

const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';

export async function handleGenerateImage(
  request: { params: { arguments: GenerateImageToolRequest } },
  apiKey: string,
) {
  const { prompt, model, save_path } = request.params.arguments;

  if (!prompt?.trim()) {
    return { content: [{ type: 'text', text: 'Prompt is required.' }], isError: true };
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || DEFAULT_MODEL, messages: [{ role: 'user', content: `Generate an image: ${prompt}` }] }),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json() as any;
    const message = data.choices?.[0]?.message;
    if (!message) {
      return { content: [{ type: 'text', text: 'No response from model.' }], isError: true };
    }

    const base64 = extractBase64(message);
    if (base64) {
      if (save_path) {
        const dir = dirname(save_path);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(save_path, Buffer.from(base64.data, 'base64'));
        return { content: [{ type: 'text', text: `Image saved to: ${save_path}` }, { type: 'image', mimeType: base64.mime, data: base64.data }] };
      }
      return { content: [{ type: 'image', mimeType: base64.mime, data: base64.data }] };
    }

    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    return { content: [{ type: 'text', text }] };
  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
}

function extractBase64(message: any): { data: string; mime: string } | null {
  // Check images array (OpenRouter/Gemini style)
  if (message.images?.length) {
    for (const img of message.images) {
      const result = parseDataUrl(img.image_url?.url || img.url);
      if (result) return result;
    }
  }

  // Check content array
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      const url = part.image_url?.url || part.url;
      if (url) { const r = parseDataUrl(url); if (r) return r; }
      if (part.inline_data?.data) return { data: part.inline_data.data, mime: part.inline_data.mime_type || 'image/png' };
      if (part.type === 'image' && part.data) return { data: part.data, mime: part.mime_type || 'image/png' };
    }
  }

  // Check string content for embedded base64
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
