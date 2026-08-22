/** Dedicated POST /api/v1/images — distinct from chat-completions `generate_image`. */
import { promises as fs } from 'node:fs';
import type { OpenRouterAPIClient, ImageGenerationResponse } from '../openrouter-api.js';
import {
  resolveOptionalOutputPath,
  isToolErrorResult,
  UnsafeOutputPathError,
} from './path-safety.js';
import { toOpenRouterImageReference } from './image-source.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { type CacheOptions, buildCacheHeaders } from './cache.js';

export interface GenerateImageDedicatedRequest extends CacheOptions {
  prompt: string;
  model?: string;
  resolution?: string;
  aspect_ratio?: string;
  quality?: string;
  output_format?: string;
  n?: number;
  input_references?: string[];
  save_path?: string;
  provider?: Record<string, unknown>;
}

const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';

const VALID_RESOLUTIONS = new Set(['512', '0.5K', '1K', '2K', '4K']);
const VALID_QUALITIES = new Set(['auto', 'low', 'medium', 'high']);
const VALID_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp', 'svg']);

const MIME_BY_FORMAT: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  jpeg: 'image/jpeg',
};

export async function handleGenerateImageDedicated(
  request: { params: { arguments: GenerateImageDedicatedRequest } },
  apiClient: OpenRouterAPIClient,
) {
  const args = request.params.arguments ?? ({} as GenerateImageDedicatedRequest);
  const {
    prompt,
    model,
    resolution,
    aspect_ratio,
    quality,
    output_format,
    n,
    input_references,
    save_path,
    provider,
    cache,
    cache_ttl,
    cache_clear,
  } = args;

  if (!prompt?.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'prompt is required.');
  }

  logger.audit('generate_image_dedicated.start', {
    model: model || DEFAULT_MODEL,
    prompt_preview: prompt.slice(0, 80),
    resolution,
    aspect_ratio,
    quality,
    output_format,
    input_references_count: input_references?.length ?? 0,
    save_path: save_path ? 'provided' : 'none',
  });

  if (resolution && !VALID_RESOLUTIONS.has(resolution)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `resolution '${resolution}' is not supported. Valid: ${[...VALID_RESOLUTIONS].join(', ')}.`,
    );
  }
  if (quality && !VALID_QUALITIES.has(quality)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `quality '${quality}' is not supported. Valid: ${[...VALID_QUALITIES].join(', ')}.`,
    );
  }
  if (output_format && !VALID_OUTPUT_FORMATS.has(output_format)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `output_format '${output_format}' is not supported. Valid: ${[...VALID_OUTPUT_FORMATS].join(', ')}.`,
    );
  }

  const savePathResult = await resolveOptionalOutputPath(save_path);
  if (isToolErrorResult(savePathResult)) return savePathResult;
  const safeSavePath = savePathResult.path;

  const body: Record<string, unknown> = {
    model: model || DEFAULT_MODEL,
    prompt,
  };
  if (resolution) body.resolution = resolution;
  if (aspect_ratio) body.aspect_ratio = aspect_ratio;
  if (quality) body.quality = quality;
  if (output_format) body.output_format = output_format;
  if (typeof n === 'number' && n > 0) body.n = n;
  if (provider && typeof provider === 'object') body.provider = provider;

  if (input_references?.length) {
    try {
      const refs = await Promise.all(input_references.map(toOpenRouterImageReference));
      body.input_references = refs;
    } catch (err) {
      if (err instanceof UnsafeOutputPathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
      return toolErrorFrom(ErrorCode.INVALID_INPUT, err, 'input_references');
    }
  }

  const headers = buildCacheHeaders({ cache, cache_ttl, cache_clear });

  let response: ImageGenerationResponse;
  try {
    response = await apiClient.generateImage(body, headers);
  } catch (err) {
    return classifyUpstreamError(err, 'generate_image_dedicated');
  }

  const images = response.data ?? [];
  if (!images.length || (!images[0]?.b64_json && !images[0]?.url)) {
    return toolError(ErrorCode.UPSTREAM_REFUSED, 'Model returned no image data.', {
      response_keys: Object.keys(response),
    });
  }

  const firstImage = images[0]!;
  const imageData = firstImage.b64_json;
  const mimeType = MIME_BY_FORMAT[output_format ?? ''] ?? 'image/png';

  const baseMeta: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    model: model || DEFAULT_MODEL,
    images_count: images.length,
  };
  if (response.usage) baseMeta.usage = response.usage;
  if (firstImage.revised_prompt) baseMeta.revised_prompt = firstImage.revised_prompt;

  if (safeSavePath && imageData) {
    try {
      await fs.writeFile(safeSavePath, imageData, { encoding: 'base64' });
    } catch (err) {
      return toolErrorFrom(ErrorCode.INTERNAL, err, 'Write');
    }
    baseMeta.save_path = safeSavePath;

    return {
      content: [
        { type: 'text' as const, text: `Image saved to: ${safeSavePath}` },
        ...(imageData ? [{ type: 'image' as const, mimeType, data: imageData }] : []),
      ],
      _meta: baseMeta,
    };
  }

  if (imageData) {
    return {
      content: [{ type: 'image' as const, mimeType, data: imageData }],
      _meta: baseMeta,
    };
  }

  return {
    content: [{ type: 'text' as const, text: `Image generated. URL: ${firstImage.url}` }],
    _meta: { ...baseMeta, image_url: firstImage.url },
  };
}
