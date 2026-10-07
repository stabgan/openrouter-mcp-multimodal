import { extname } from 'node:path';
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
import { extensionForImageMime, sniffImageMime } from './image-utils.js';
import { type CacheOptions, buildCacheHeaders, validateCacheOptions } from './cache.js';
import { replaceExtension, writeOutputFile } from './path-utils.js';
import {
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  type ProviderRoutingOptions,
} from './provider-routing.js';

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
    model: model?.trim() || DEFAULT_MODEL,
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
  if (
    typeof n === 'number' &&
    (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_IMAGES)
  ) {
    return toolError(ErrorCode.INVALID_INPUT, `n must be between 1 and ${MAX_IMAGES} (inclusive).`);
  }

  if (input_references !== undefined) {
    if (!Array.isArray(input_references)) {
      return toolError(ErrorCode.INVALID_INPUT, 'input_references must be an array of strings.');
    }
    if (input_references.some((r) => typeof r !== 'string' || !r.trim())) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        'every input_references entry must be a non-empty string.',
      );
    }
    if (input_references.length > 20) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `input_references has ${input_references.length} entries — max 20.`,
      );
    }
  }

  const cacheError = validateCacheOptions({ cache, cache_ttl, cache_clear });
  if (cacheError) return cacheError;

  const savePathResult = await resolveOptionalOutputPath(save_path);
  if (isToolErrorResult(savePathResult)) return savePathResult;
  const safeSavePath = savePathResult.path;

  const body: Record<string, unknown> = {
    model: model?.trim() || DEFAULT_MODEL,
    prompt,
  };
  if (resolution) body.resolution = resolution;
  if (aspect_ratio) body.aspect_ratio = aspect_ratio;
  if (quality) body.quality = quality;
  if (output_format) body.output_format = output_format;
  if (typeof n === 'number') body.n = n;
  // Merge user-supplied provider options with OPENROUTER_PROVIDER_* env defaults.
  // Previously generate_image_dedicated bypassed env defaults — only chat tools applied them.
  const mergedProvider = buildProviderBody(
    mergeProviderOptions(readProviderDefaults(), provider as ProviderRoutingOptions),
  );
  if (mergedProvider) body.provider = mergedProvider;

  if (input_references?.length) {
    try {
      const refs = await Promise.all(input_references.map(toOpenRouterImageReference));
      body.input_references = refs;
    } catch (err) {
      if (err instanceof UnsafeOutputPathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (msg.includes('Blocked host')) {
        return toolErrorFrom(ErrorCode.UPSTREAM_REFUSED, err, 'input_references');
      }
      if (lower.includes('too large')) {
        return toolErrorFrom(ErrorCode.RESOURCE_TOO_LARGE, err, 'input_references');
      }
      if (lower.includes('timed out') || lower.includes('timeout')) {
        return toolErrorFrom(ErrorCode.UPSTREAM_TIMEOUT, err, 'input_references');
      }
      if (lower.includes('unsupported') || lower.includes('invalid data url')) {
        return toolErrorFrom(ErrorCode.UNSUPPORTED_FORMAT, err, 'input_references');
      }
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

  // Decode the image buffer first so we can sniff the actual format.
  const decoded = decodeImageBuffer(firstImage.b64_json);

  // When the user explicitly requested an output_format, trust that mapping.
  // Otherwise sniff the actual image magic bytes so we don't blindly label
  // a JPEG or WebP response as image/png (BUG-013: wrong MIME in _meta and
  // inline media blocks when output_format is omitted).
  const mimeType =
    MIME_BY_FORMAT[output_format ?? ''] ??
    (decoded ? sniffImageMime(decoded) : null) ??
    'image/png';

  const baseMeta: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    model: model?.trim() || DEFAULT_MODEL,
    images_count: images.length,
    saved_image_index: 0,
  };
  if (images.length > 1) {
    baseMeta.images_note = 'Only images[0] is saved or inlined; request n=1 for a single image.';
  }
  if (response.usage) baseMeta.usage = response.usage;
  if (firstImage.revised_prompt) baseMeta.revised_prompt = firstImage.revised_prompt;

  if (safeSavePath) {
    // Correct the file extension to match the actual image format — mirrors
    // the pattern used by generate_video, generate_audio, and text_to_speech.
    // Without this, a user requesting save_path: "out.jpg" would get a PNG
    // saved with a .jpg extension when the API returns PNG.
    const expectedExt = extensionForImageMime(mimeType);
    const currentExt = extname(safeSavePath).toLowerCase().slice(1);
    const correctedPath =
      currentExt === expectedExt ? safeSavePath : replaceExtension(safeSavePath, expectedExt);

    if (decoded) {
      try {
        await writeOutputFile(correctedPath, decoded);
      } catch (err) {
        return toolErrorFrom(ErrorCode.INTERNAL, err, 'Write');
      }
      return buildBinaryToolResult(
        { kind: 'image', buffer: decoded, mimeType },
        {
          savedPath: correctedPath,
          summaryText: `Image saved to: ${correctedPath}`,
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
        // Re-derive extension from actual download MIME for accuracy.
        const dlExt = extensionForImageMime(resolvedMime);
        const dlPath = currentExt === dlExt ? safeSavePath : replaceExtension(safeSavePath, dlExt);
        await writeOutputFile(dlPath, fetched);
        return buildBinaryToolResult(
          { kind: 'image', buffer: fetched, mimeType: resolvedMime },
          {
            savedPath: dlPath,
            summaryText: `Image saved to: ${dlPath}`,
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
