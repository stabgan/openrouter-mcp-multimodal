import { ModelCache } from '../model-cache.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode, toolError } from '../errors.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildStructuredResult } from './structured-output.js';

/**
 * Model IDs follow the `org/model-name[:suffix]` pattern — 256 chars is
 * generous for any real identifier while preventing multi-megabyte strings
 * from inflating MCP responses (the model string is reflected in the result).
 */
const MAX_MODEL_ID_LENGTH = 256;

export async function handleValidateModel(
  request: { params: { arguments: { model: string } } },
  modelCache: ModelCache,
  apiClient?: OpenRouterAPIClient,
) {
  const rawModel = request.params.arguments?.model;

  if (rawModel !== undefined && typeof rawModel !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'model must be a string.');
  }

  const model = typeof rawModel === 'string' ? rawModel.trim() : '';

  if (!model) {
    return toolError(ErrorCode.INVALID_INPUT, 'model is required.');
  }
  if (model.length > MAX_MODEL_ID_LENGTH) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `model identifier exceeds max length ${MAX_MODEL_ID_LENGTH} (got ${model.length}).`,
    );
  }

  if (apiClient) {
    try {
      await modelCache.ensureFresh(() => apiClient.getModels());
    } catch (error: unknown) {
      return classifyUpstreamError(error, 'validate_model');
    }
  }

  if (!modelCache.isValid()) {
    return toolError(ErrorCode.INTERNAL, 'No model data available.');
  }

  const valid = modelCache.catalogHas(model);
  return buildStructuredResult({ valid, model });
}
