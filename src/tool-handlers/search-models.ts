import { ModelCache } from '../model-cache.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode, toolErrorFrom } from '../errors.js';
import { classifyUpstreamError } from './openrouter-errors.js';

export interface SearchModelsArgs {
  query?: string;
  provider?: string;
  capabilities?: { vision?: boolean };
  limit?: number;
}

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
    const results = modelCache.search(request.params.arguments ?? {});
    return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
  } catch (error: unknown) {
    return toolErrorFrom(ErrorCode.INTERNAL, error, 'search_models');
  }
}
