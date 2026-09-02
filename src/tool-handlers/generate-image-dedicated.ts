import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_DEDICATED_QUALITIES,
  IMAGE_DEDICATED_RESOLUTIONS,
  IMAGE_OUTPUT_FORMATS,
} from '../tool-definitions.js';
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
import { buildBinaryToolResult } from './tool-result-payload.js';
import { fetchHttpResource, readEnvInt } from './fetch-utils.js';
import { type CacheOptions, buildCacheHeaders, validateCacheOptions } from './cache.js';
import { writeOutputFile } from './path-utils.js';

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
const MAX_IMAGES = 10;

const VALID_ASPECT_RATIOS = new Set<string>(IMAGE_ASPECT_RATIOS);
const VALID_RESOLUTIONS = new Set<string>(IMAGE_DEDICATED_RESOLUTIONS);
const VALID_QUALITIES = new Set<string>(IMAGE_DEDICATED_QUALITIES);
const VALID_OUTPUT_FORMATS = new Set<string>(IMAGE_OUTPUT_FORMATS);

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

  if (aspect_ratio && !VALID_ASPECT_RATIOS.has(aspect_ratio)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `aspect_ratio '${aspect_ratio}' is not supported. Valid: ${[...VALID_ASPECT_RATIOS].join(', ')}.`,
    );
  }
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
  if (typeof n === 'number' && (n < 1 || n > MAX_IMAGES)) {
    return toolError(ErrorCode.INVALID_INPUT, `n must be between 1 and ${MAX_IMAGES} (inclusive).`);
  }

  const cacheError = validateCacheOptions({ cache, cache_ttl, cache_clear });
  if (cacheError) return cacheError;

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
  if (typeof n === 'number') body.n = n;
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
  const mimeType = MIME_BY_FORMAT[output_format ?? ''] ?? 'image/png';

  const baseMeta: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    model: model || DEFAULT_MODEL,
    images_count: images.length,
    saved_image_index: 0,
  };
  if (images.length > 1) {
    baseMeta.images_note = 'Only images[0] is saved or inlined; request n=1 for a single image.';
  }
  if (response.usage) baseMeta.usage = response.usage;
  if (firstImage.revised_prompt) baseMeta.revised_prompt = firstImage.revised_prompt;

  const decoded = decodeImageBuffer(firstImage.b64_json);

  if (safeSavePath) {
    if (decoded) {
      try {
        await writeOutputFile(safeSavePath, decoded);
      } catch (err) {
        return toolErrorFrom(ErrorCode.INTERNAL, err, 'Write');
      }
      return buildBinaryToolResult(
        { kind: 'image', buffer: decoded, mimeType },
        {
          savedPath: safeSavePath,
          summaryText: `Image saved to: ${safeSavePath}`,
          meta: baseMeta,
        },
      );
    }

    if (firstImage.url) {
      try {
        const maxBytes = readEnvInt('OPENROUTER_IMAGE_MAX_DOWNLOAD_BYTES', 20 * 1024 * 1024, 1024);
        const { buffer: fetched, contentType } = await fetchHttpResource(firstImage.url, {
          maxBytes,
          maxRedirects: 3,
          timeoutMs: 30_000,
        });
        if (fetched.length === 0) {
          return toolError(ErrorCode.UPSTREAM_REFUSED, 'Downloaded image URL returned empty body.');
        }
        const resolvedMime = contentType?.split(';')[0]?.trim() || mimeType;
        await writeOutputFile(safeSavePath, fetched);
        return buildBinaryToolResult(
          { kind: 'image', buffer: fetched, mimeType: resolvedMime },
          {
            savedPath: safeSavePath,
            summaryText: `Image saved to: ${safeSavePath}`,
            meta: { ...baseMeta, mime: resolvedMime, image_url: firstImage.url },
          },
        );
      } catch (err) {
        return toolErrorFrom(ErrorCode.UPSTREAM_HTTP, err, 'Download image URL for save_path');
      }
    }

    return toolError(
      ErrorCode.UPSTREAM_REFUSED,
      'Model returned no usable image data for save_path (empty b64_json and URL download unavailable).',
    );
  }

  if (decoded) {
    return buildBinaryToolResult(
      { kind: 'image', buffer: decoded, mimeType },
      { inlineOnly: true, meta: baseMeta },
    );
  }

  if (firstImage.url) {
    return {
      content: [{ type: 'text' as const, text: `Image generated. URL: ${firstImage.url}` }],
      _meta: { ...baseMeta, image_url: firstImage.url },
    };
  }

  return toolError(ErrorCode.UPSTREAM_REFUSED, 'Model returned no usable image data.');
}

function decodeImageBuffer(b64?: string | null): Buffer | null {
  if (!b64) return null;
  try {
    const buffer = Buffer.from(b64, 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}
