import { promises as fs } from 'fs';
import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import { resolveSafeOutputPath, UnsafeOutputPathError } from './path-safety.js';
import { parseBase64DataUrl } from './fetch-utils.js';
import { buildUserContent } from './generate-image-input.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';

export interface GenerateImageToolRequest {
  prompt: string;
  model?: string;
  save_path?: string;
  aspect_ratio?: string;
  image_size?: string;
  max_tokens?: number;
  input_images?: string[];
  modalities?: string[];
}

const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';

const VALID_ASPECT_RATIOS = new Set([
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
]);

const VALID_IMAGE_SIZES = new Set(['0.5K', '1K', '2K', '4K']);

export async function handleGenerateImage(
  request: { params: { arguments: GenerateImageToolRequest } },
  openai: OpenAI,
) {
  const {
    prompt,
    model,
    save_path,
    aspect_ratio,
    image_size,
    max_tokens,
    input_images,
    modalities,
  } = request.params.arguments ?? { prompt: '' };

  if (!prompt?.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'prompt is required.');
  }

  logger.audit('generate_image.start', {
    model: model || DEFAULT_MODEL,
    prompt_preview: prompt.slice(0, 80),
    aspect_ratio,
    image_size,
    save_path: save_path ? 'provided' : 'none',
    input_images_count: input_images?.length ?? 0,
  });

  if (aspect_ratio !== undefined && !VALID_ASPECT_RATIOS.has(aspect_ratio)) {
    return invalidEnumError('aspect_ratio', aspect_ratio, VALID_ASPECT_RATIOS);
  }
  if (image_size !== undefined && !VALID_IMAGE_SIZES.has(image_size)) {
    return invalidEnumError('image_size', image_size, VALID_IMAGE_SIZES);
  }

  let safePathResolved: string | null = null;
  if (save_path) {
    try {
      safePathResolved = await resolveSafeOutputPath(save_path);
    } catch (err) {
      if (err instanceof UnsafeOutputPathError) {
        return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
      }
      return toolErrorFrom(ErrorCode.INTERNAL, err);
    }
  }

  let content: string | OpenAI.Chat.Completions.ChatCompletionContentPart[];
  try {
    content = await buildUserContent(prompt, input_images);
  } catch (err) {
    if (err instanceof UnsafeOutputPathError) {
      return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
    }
    return toolErrorFrom(ErrorCode.INVALID_INPUT, err, 'input_images');
  }

  const imageConfig: Record<string, string> = {};
  if (aspect_ratio) imageConfig.aspect_ratio = aspect_ratio;
  if (image_size) imageConfig.image_size = image_size;

  const body: Record<string, unknown> = {
    model: model || DEFAULT_MODEL,
    messages: [{ role: 'user', content }],
    modalities: modalities?.length ? modalities : ['image', 'text'],
  };
  if (Object.keys(imageConfig).length > 0) body.image_config = imageConfig;
  if (typeof max_tokens === 'number' && max_tokens > 0) body.max_tokens = max_tokens;

  let completion: ChatCompletion;
  try {
    completion = (await openai.chat.completions.create(
      body as unknown as Parameters<typeof openai.chat.completions.create>[0],
    )) as ChatCompletion;
  } catch (err) {
    return classifyUpstreamError(err, 'generate_image');
  }

  const message = completion.choices[0]?.message;
  if (!message) {
    return toolError(ErrorCode.INTERNAL, 'No response from model.');
  }

  const base64 = extractBase64(message as unknown as Record<string, unknown>);
  if (!base64) {
    const messageContent = message.content;
    const text =
      typeof messageContent === 'string' ? messageContent : JSON.stringify(messageContent);
    return toolError(
      ErrorCode.UPSTREAM_REFUSED,
      `Model returned no image. Text response: ${text.slice(0, 300)}`,
      {
        reason: 'no_image_in_response',
        finish_reason: completion.choices[0]?.finish_reason,
      },
    );
  }

  if (safePathResolved) {
    try {
      await fs.writeFile(safePathResolved, base64.data, { encoding: 'base64' });
    } catch (err) {
      return toolErrorFrom(ErrorCode.INTERNAL, err, 'Write');
    }
  }

  return buildImageSuccessResult(base64, completion.usage, safePathResolved ?? undefined);
}

function invalidEnumError(field: string, value: string, allowed: Set<string>) {
  return toolError(
    ErrorCode.INVALID_INPUT,
    `${field} '${value}' is not supported. Valid values: ${[...allowed].join(', ')}.`,
  );
}

function buildImageSuccessResult(
  base64: { data: string; mime: string },
  usage: ChatCompletion['usage'],
  savePath?: string,
) {
  const usageMeta = usage
    ? {
        usage: {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        },
      }
    : {};

  if (savePath) {
    return {
      content: [
        { type: 'text' as const, text: `Image saved to: ${savePath}` },
        { type: 'image' as const, mimeType: base64.mime, data: base64.data },
      ],
      _meta: {
        server_version: SERVER_VERSION,
        save_path: savePath,
        mime: base64.mime,
        ...usageMeta,
      },
    };
  }

  return {
    content: [{ type: 'image' as const, mimeType: base64.mime, data: base64.data }],
    _meta: {
      server_version: SERVER_VERSION,
      mime: base64.mime,
      ...usageMeta,
    },
  };
}

function extractBase64(message: Record<string, unknown>): { data: string; mime: string } | null {
  const images = message.images;
  if (Array.isArray(images) && images.length) {
    for (const img of images as Record<string, unknown>[]) {
      const imageUrl = img.image_url as { url?: string } | undefined;
      const result = dataUrlToBase64((imageUrl?.url as string) || (img.url as string | undefined));
      if (result) return result;
    }
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content as Record<string, unknown>[]) {
      const iu = part.image_url as { url?: string } | undefined;
      const url = iu?.url || (part.url as string | undefined);
      if (url) {
        const r = dataUrlToBase64(url);
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
    // Data URLs may carry MIME parameters (e.g. charset=binary) that break naive regexes.
    const start = message.content.indexOf('data:image/');
    if (start >= 0) {
      const tail = message.content.slice(start);
      const end = tail.search(/[\s)"']/);
      const url = end === -1 ? tail : tail.slice(0, end);
      const parsed = dataUrlToBase64(url);
      if (parsed) return parsed;
    }
  }

  return null;
}

function dataUrlToBase64(url?: string): { data: string; mime: string } | null {
  if (!url?.startsWith('data:')) return null;
  const parsed = parseBase64DataUrl(url);
  if (!parsed) return null;
  return { data: parsed.base64, mime: parsed.mediaType };
}
