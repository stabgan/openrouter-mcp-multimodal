import { ModelCache } from '../model-cache.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode, toolError } from '../errors.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildStructuredResult } from './structured-output.js';

export async function handleGetModelInfo(
  request: { params: { arguments: { model: string } } },
  modelCache: ModelCache,
  apiClient?: OpenRouterAPIClient,
) {
  const { model } = request.params.arguments ?? { model: '' };

  if (!model || typeof model !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'model is required.');
  }

  if (apiClient) {
    try {
      await modelCache.ensureFresh(() => apiClient.getModels());
    } catch (error: unknown) {
      return classifyUpstreamError(error, 'get_model_info');
    }
  }

  if (!modelCache.isValid()) {
    return toolError(ErrorCode.INTERNAL, 'No model data available.');
  }

  const info = modelCache.get(model);
  if (!info) {
    return toolError(ErrorCode.MODEL_NOT_FOUND, `Model '${model}' not found.`);
  }

  return buildStructuredResult(info);
}
