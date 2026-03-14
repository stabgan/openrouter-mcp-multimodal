import { ModelCache } from '../model-cache.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';

export async function handleSearchModels(
  request: { params: { arguments: any } },
  apiClient: OpenRouterAPIClient,
  modelCache: ModelCache,
) {
  try {
    if (!modelCache.isValid()) {
      modelCache.setModels(await apiClient.getModels());
    }
    const results = modelCache.search(request.params.arguments);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
}
