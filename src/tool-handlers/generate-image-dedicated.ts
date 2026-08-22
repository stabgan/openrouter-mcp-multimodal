/**
 * generate_image_dedicated — uses OpenRouter's dedicated POST /api/v1/images
 * endpoint (launched June 2026) for image generation. Supports normalized
 * resolution tiers, aspect ratios, quality levels, output formats, and
 * input_references for image-to-image workflows.
 *
 * This is distinct from the original `generate_image` tool which uses chat
 * completions with `modalities: ['image', 'text']`. New image models are
 * added exclusively to this dedicated endpoint.
 */
import { promises as fs } from 'fs';
import path from 'node:path';
import type { OpenRouterAPIClient, ImageGenerationResponse } from '../openrouter-api.js';
import { resolveSafeOutputPath, resolveSafeInputPath, UnsafeOutputPathError } from './path-safety.js';
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

/**
 * Resolve an input image reference (local path, URL, or data URL) into the
 * OpenRouter `input_references` shape: `{ type: "image_url", image_url: { url } }`.
 */
async function resolveReference(source: string): Promise<{ type: string; image_url: { url: string } }> {
  const trimmed = source.trim();
  if (!trimmed) throw new Error('Empty input_references entry');

  // Data URLs and HTTP URLs pass through directly
  if (trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)) {
    return { type: 'image_url', image_url: { url: trimmed } };
  }

  // Local file: sandbox, read, and convert to data URL
  const abs = await resolveSafeInputPath(trimmed);
  const buf = await fs.readFile(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime =
    ext === '.png' ? 'image/png' :
    ext === '.webp' ? 'image/webp' :
    ext === '.gif' ? 'image/gif' :
    ext === '.svg' ? 'image/svg+xml' :
    'image/jpeg';
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  return { type: 'image_url', image_url: { url: dataUrl } };
}

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

  // Validate enums
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

  // Resolve save path early
  let safeSavePath: string | null = null;
  if (save_path) {
    try {
      safeSavePath = await resolveSafeOutputPath(save_path);
    } catch (err) {
      if (err instanceof UnsafeOutputPathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
      return toolErrorFrom(ErrorCode.INTERNAL, err);
    }
  }

  // Build request body
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

  // Resolve input references
  if (input_references?.length) {
    try {
      const refs = await Promise.all(input_references.map(resolveReference));
      body.input_references = refs;
    } catch (err) {
      if (err instanceof UnsafeOutputPathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
      return toolErrorFrom(ErrorCode.INVALID_INPUT, err, 'input_references');
    }
  }

  // Build cache headers
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
  const mimeType = output_format === 'png' ? 'image/png' :
    output_format === 'webp' ? 'image/webp' :
    output_format === 'svg' ? 'image/svg+xml' :
    output_format === 'jpeg' ? 'image/jpeg' :
    'image/png'; // default

  const baseMeta: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    model: model || DEFAULT_MODEL,
    images_count: images.length,
  };
  if (response.usage) baseMeta.usage = response.usage;
  if (firstImage.revised_prompt) baseMeta.revised_prompt = firstImage.revised_prompt;

  // Save to file if requested
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

  // Return inline
  if (imageData) {
    return {
      content: [{ type: 'image' as const, mimeType, data: imageData }],
      _meta: baseMeta,
    };
  }

  // URL-only response (some models return URLs instead of base64)
  return {
    content: [
      { type: 'text' as const, text: `Image generated. URL: ${firstImage.url}` },
    ],
    _meta: { ...baseMeta, image_url: firstImage.url },
  };
}
