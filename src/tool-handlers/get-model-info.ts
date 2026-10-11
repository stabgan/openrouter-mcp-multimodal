import { ModelCache, sanitizeModelRecordForOutput } from '../model-cache.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode, toolError } from '../errors.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildStructuredResult } from './structured-output.js';

/**
 * Model IDs follow the `org/model-name[:suffix]` pattern — 256 chars is
 * generous for any real identifier while preventing multi-megabyte strings
 * from inflating error messages and MCP responses (reflection amplification).
 */
const MAX_MODEL_ID_LENGTH = 256;

export async function handleGetModelInfo(
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
      return classifyUpstreamError(error, 'get_model_info');
    }
  }

  if (!modelCache.isValid()) {
    return toolError(ErrorCode.INTERNAL, 'No model data available.');
  }

  const info = modelCache.lookup(model);
  if (!info) {
    return toolError(ErrorCode.MODEL_NOT_FOUND, `Model '${model}' not found.`, undefined, {
      suggestions: [
        'Use search_models to discover valid model ids',
        'Use validate_model to pre-flight a model id',
      ],
    });
  }

  return buildStructuredResult(sanitizeModelRecordForOutput(info));
}
