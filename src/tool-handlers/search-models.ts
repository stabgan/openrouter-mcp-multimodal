import { ModelCache } from '../model-cache.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';

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
    if (!modelCache.isValid()) {
      modelCache.setModels(await apiClient.getModels());
    }
    const results = modelCache.search(request.params.arguments);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
}
