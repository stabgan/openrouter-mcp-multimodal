import { ModelCache } from '../model-cache.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';

export async function handleGetModelInfo(
  request: { params: { arguments: { model: string } } },
  modelCache: ModelCache,
  apiClient?: OpenRouterAPIClient,
) {
  const { model } = request.params.arguments;

  if (!modelCache.isValid() && apiClient) {
    modelCache.setModels(await apiClient.getModels());
  }

  if (!modelCache.isValid()) {
    return { content: [{ type: 'text', text: 'No model data available.' }], isError: true };
  }

  const info = modelCache.get(model);
  if (!info) {
    return { content: [{ type: 'text', text: `Model '${model}' not found.` }], isError: true };
  }

  return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
}
