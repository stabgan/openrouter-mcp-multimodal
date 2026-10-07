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

  // Validate numeric params — MCP clients that ignore the JSON schema can
  // send strings, booleans, or other types. Without this guard the handler
  // silently falls back to defaults, which is confusing (e.g. `limit: "50"`
  // returns only 20 results with no error). Matches the explicit typeof
  // checks used by every other handler (chat_completion, generate_video,
  // rerank, etc.). Range clamping is handled by clampLimit/clampOffset.
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
