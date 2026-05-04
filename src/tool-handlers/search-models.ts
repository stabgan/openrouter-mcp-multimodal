import { ModelCache, type OpenRouterModelRecord } from '../model-cache.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode, toolErrorFrom } from '../errors.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildStructuredResult } from './structured-output.js';

export interface SearchModelsArgs {
  query?: string;
  provider?: string;
  capabilities?: { vision?: boolean; audio?: boolean; video?: boolean };
  limit?: number;
  /**
   * Skip this many matching results before returning `limit`. Paired with
   * `limit` and the returned `next_offset` to let large model lists be
   * paged safely. Follows Phil Schmid's "paginate large results" best
   * practice.
   */
  offset?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function handleSearchModels(
  request: { params: { arguments: SearchModelsArgs } },
  apiClient: OpenRouterAPIClient,
  modelCache: ModelCache,
) {
  try {
    await modelCache.ensureFresh(() => apiClient.getModels());
  } catch (error: unknown) {
    return classifyUpstreamError(error, 'search_models');
  }
  try {
    const args = request.params.arguments ?? {};
    const limit = Math.min(Math.max(1, args.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const offset = Math.max(0, args.offset ?? 0);

    // Get the full filtered set, then slice for pagination.
    const all = modelCache.search({
      query: args.query,
      provider: args.provider,
      capabilities: args.capabilities,
      all: true,
    }) as OpenRouterModelRecord[];
    const total = all.length;
    const page = all.slice(offset, offset + limit);
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
