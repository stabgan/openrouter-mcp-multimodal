import { ModelCache } from '../model-cache.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';

export async function handleValidateModel(
  request: { params: { arguments: { model: string } } },
  modelCache: ModelCache,
  apiClient?: OpenRouterAPIClient,
) {
  if (!modelCache.isValid() && apiClient) {
    modelCache.setModels(await apiClient.getModels());
  }

  if (!modelCache.isValid()) {
    return { content: [{ type: 'text', text: 'No model data available.' }], isError: true };
  }

  return { content: [{ type: 'text', text: JSON.stringify({ valid: modelCache.has(request.params.arguments.model) }) }] };
}
