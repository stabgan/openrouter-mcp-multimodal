import { ModelCache, clampLimit, clampOffset, MAX_SEARCH_LIMIT } from '../model-cache.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildStructuredResult } from './structured-output.js';

export interface SearchModelsArgs {
  query?: string;
  provider?: string;
  capabilities?: { vision?: boolean; audio?: boolean; video?: boolean };
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 20;

export async function handleSearchModels(
  request: { params: { arguments: SearchModelsArgs } },
  apiClient: OpenRouterAPIClient,
  modelCache: ModelCache,
) {
  const args = request.params.arguments ?? {};

  // Validate param types — MCP clients that ignore the JSON schema can
  // send numbers, booleans, or other types. Without these guards the handler
  // either silently falls back to defaults (confusing) or crashes with a
  // TypeError when buildMatcher() calls .trim() on a non-string value.
  // Matches the explicit typeof checks used by every other handler
  // (chat_completion, generate_video, rerank, etc.).
  if (args.query !== undefined && typeof args.query !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'query must be a string.');
  }
  if (args.provider !== undefined && typeof args.provider !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'provider must be a string.');
  }
  if (
    args.capabilities !== undefined &&
    (typeof args.capabilities !== 'object' ||
      args.capabilities === null ||
      Array.isArray(args.capabilities))
  ) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      'capabilities must be an object (e.g. { "vision": true }).',
    );
  }
  // Range clamping is handled by clampLimit/clampOffset.
  if (args.limit !== undefined) {
    if (typeof args.limit !== 'number' || !Number.isFinite(args.limit)) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `limit must be a number (integer 1–${MAX_SEARCH_LIMIT}).`,
      );
    }
  }
  if (args.offset !== undefined) {
    if (typeof args.offset !== 'number' || !Number.isFinite(args.offset)) {
      return toolError(ErrorCode.INVALID_INPUT, 'offset must be a non-negative integer.');
    }
  }

  try {
    await modelCache.ensureFresh(() => apiClient.getModels());
  } catch (error: unknown) {
    return classifyUpstreamError(error, 'search_models');
  }
  try {
    const limit = clampLimit(args.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT);
    const offset = clampOffset(args.offset ?? 0);

    const { page, total } = modelCache.searchPaginated(
      {
        query: args.query,
        provider: args.provider,
        capabilities: args.capabilities,
      },
      offset,
      limit,
    );
    const nextOffset = offset + limit;
    const hasMore = nextOffset < total;

    return buildStructuredResult({
      results: page,
      offset,
      limit,
      total,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : null,
    });
  } catch (error: unknown) {
    return toolErrorFrom(ErrorCode.INTERNAL, error, 'search_models');
  }
}
