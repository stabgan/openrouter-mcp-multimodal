import { promises as fs } from 'fs';
import path from 'node:path';
import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import { resolveSafeOutputPath, resolveSafeInputPath, UnsafeOutputPathError } from './path-safety.js';
import { parseBase64DataUrl } from './fetch-utils.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';

export interface GenerateImageToolRequest {
  prompt: string;
  model?: string;
  save_path?: string;
  /**
   * Output aspect ratio. Passed through as `image_config.aspect_ratio`.
   * Supported by OpenRouter image models (e.g. `1:1`, `16:9`, `9:16`,
   * `4:3`, `3:4`, `21:9`). Model-dependent. Unsupported values fall back
   * to the model's default. See
   * https://openrouter.ai/docs/guides/overview/multimodal/image-generation
   */
  aspect_ratio?: string;
  /**
   * Output image resolution bucket. Passed through as
   * `image_config.image_size`. Typical values: `0.5K`, `1K` (default),
   * `2K`, `4K`. Model-dependent.
   */
  image_size?: string;
  /**
   * Upper bound on the completion budget. Without this OpenRouter
   * reserves the model's full context window (~29k for Gemini
   * image models), which can trigger a 402 on low-credit accounts even
   * though the actual generation uses far fewer tokens. 4096 is plenty
   * for the image payload + any caption.
   */
  max_tokens?: number;
  /**
   * Optional reference images. Each entry is one of:
   *   - a `data:image/...;base64,...` URL,
   *   - an `http(s)://` URL (OpenRouter fetches it),
   *   - a local file path (sandboxed to `OPENROUTER_INPUT_DIR` /
   *     `OPENROUTER_OUTPUT_DIR` / cwd, read + base64-encoded by the server).
   *
   * When provided, the user message becomes multimodal: a text prompt
   * plus one `image_url` block per reference, in array order. Enables
   * character / style consistency and image-to-image refinement on
   * chat-image models that accept image inputs (Gemini Nano Banana,
   * `openai/gpt-5.4-image-2`).
   */
  input_images?: string[];
  /**
   * Override the default `modalities: ["image","text"]` sent to
   * OpenRouter. Most callers should leave this unset. Provide e.g.
   * `["text"]` to suppress image output for inspection / captioning,
   * or other shapes for future model variants.
   */
  modalities?: string[];
}

const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';

// OpenRouter-documented aspect ratios (standard + extended). Extended are
// only honored by models that support them (e.g. gemini-3.1-flash-image),
// others fall back to the model's default.
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

  // Audit entry. Bypasses the normal log level so operators always see a
  // record of cost-incurring operations. Prompt preview is hard-capped
  // at 80 chars to avoid PII spillage in log aggregators.
  logger.audit('generate_image.start', {
    model: model || DEFAULT_MODEL,
    prompt_preview: prompt.slice(0, 80),
    aspect_ratio,
    image_size,
    save_path: save_path ? 'provided' : 'none',
    input_images_count: input_images?.length ?? 0,
  });

  // Validate optional shape fields early so callers get a clear error
  // instead of a cryptic upstream 400.
  if (aspect_ratio !== undefined && !VALID_ASPECT_RATIOS.has(aspect_ratio)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `aspect_ratio '${aspect_ratio}' is not supported. Valid values: ${[...VALID_ASPECT_RATIOS].join(', ')}.`,
    );
  }
  if (image_size !== undefined && !VALID_IMAGE_SIZES.has(image_size)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `image_size '${image_size}' is not supported. Valid values: ${[...VALID_IMAGE_SIZES].join(', ')}.`,
    );
  }

  // Fail-fast on unsafe paths BEFORE spending tokens.
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

  // Build the user message. With no `input_images`, this is the original
  // string content; with refs, it becomes a multimodal
  // ChatCompletionContentPart[] (text preamble + one image_url per ref).
  let content: string | OpenAI.Chat.Completions.ChatCompletionContentPart[];
  try {
    content = await buildUserContent(prompt, input_images);
  } catch (err) {
    if (err instanceof UnsafeOutputPathError) {
      return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
    }
    return toolErrorFrom(ErrorCode.INVALID_INPUT, err, 'input_images');
  }

  // Assemble the request body. OpenRouter's image-generation guide
  // requires:
  //   - `modalities: ["image", "text"]` so multimodal models (like
  //     Gemini) know to emit an image, not just text. Caller can
  //     override via the `modalities` field.
  //   - `image_config.{aspect_ratio, image_size}` for shape control.
  // The OpenAI SDK doesn't type these fields, but passes unknown members
  // through to the server, so we attach them via a typed cast.
  const imageConfig: Record<string, string> = {};
  if (aspect_ratio) imageConfig.aspect_ratio = aspect_ratio;
  if (image_size) imageConfig.image_size = image_size;

  const body: Record<string, unknown> = {
    model: model || DEFAULT_MODEL,
    messages: [{ role: 'user', content }],
    modalities: modalities && modalities.length ? modalities : ['image', 'text'],
  };
  if (Object.keys(imageConfig).length > 0) body.image_config = imageConfig;
  if (typeof max_tokens === 'number' && max_tokens > 0) body.max_tokens = max_tokens;

  let completion: ChatCompletion;
  try {
    // OpenRouter-specific `image_config` isn't in the OpenAI SDK's typings,
    // but the SDK passes unknown fields straight through to the server.
    // We never pass `stream: true`, so the response is always
    // ChatCompletion.
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
    // Model talked but did not emit an image. Surface this as a distinct
    // condition so callers don't treat chatter as a successful image.
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
      await fs.writeFile(safePathResolved, Buffer.from(base64.data, 'base64'));
    } catch (err) {
      return toolErrorFrom(ErrorCode.INTERNAL, err, 'Write');
    }
    const usage = completion.usage;
    return {
      content: [
        { type: 'text' as const, text: `Image saved to: ${safePathResolved}` },
        { type: 'image' as const, mimeType: base64.mime, data: base64.data },
      ],
      _meta: {
        server_version: SERVER_VERSION,
        save_path: safePathResolved,
        mime: base64.mime,
        ...(usage
          ? {
              usage: {
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
              },
            }
          : {}),
      },
    };
  }

  const usage = completion.usage;
  return {
    content: [{ type: 'image' as const, mimeType: base64.mime, data: base64.data }],
    _meta: {
      server_version: SERVER_VERSION,
      mime: base64.mime,
      ...(usage
        ? {
            usage: {
              prompt_tokens: usage.prompt_tokens,
              completion_tokens: usage.completion_tokens,
              total_tokens: usage.total_tokens,
            },
          }
        : {}),
    },
  };
}

/**
 * Resolve a caller-supplied input image into a URL the chat-completions
 * API accepts. Local file paths are sandboxed via
 * `resolveSafeInputPath` (`OPENROUTER_INPUT_DIR` /
 * `OPENROUTER_OUTPUT_DIR` / cwd) and inlined as base64 data URLs.
 */
export async function resolveInputImage(ref: string): Promise<string> {
  const trimmed = ref.trim();
  if (!trimmed) throw new Error('empty input_images entry');

  if (trimmed.startsWith('data:')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const abs = await resolveSafeInputPath(trimmed);
  const buf = await fs.readFile(abs);
  const mime = mimeFromExt(path.extname(abs)) || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export function mimeFromExt(ext: string): string | null {
  const e = ext.toLowerCase().replace(/^\./, '');
  switch (e) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return null;
  }
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

  for (const ref of inputImages) {
    const url = await resolveInputImage(ref);
    parts.push({
      type: 'image_url',
      image_url: { url, detail: 'high' },
    });
  }

  return parts;
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
    // Scan the string for an embedded data URL. We deliberately don't use
    // a single regex here because data URLs may carry MIME parameters
    // (e.g. `data:image/png;charset=binary;base64,...`) which trips the
    // naive `data:([^;]+);base64,(.+)` form.
    const start = message.content.indexOf('data:image/');
    if (start >= 0) {
      // Find the end of the data URL: a whitespace or closing quote/paren.
      const tail = message.content.slice(start);
      const end = tail.search(/[\s)"']/);
      const url = end === -1 ? tail : tail.slice(0, end);
      const parsed = parseDataUrl(url);
      if (parsed) return parsed;
    }
  }

  return null;
}

function parseDataUrl(url?: string): { data: string; mime: string } | null {
  if (!url?.startsWith('data:')) return null;
  const parsed = parseBase64DataUrl(url);
  if (!parsed) return null;
  return { data: parsed.base64, mime: parsed.mediaType };
}
