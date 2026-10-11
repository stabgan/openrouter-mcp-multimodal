/**
 * embed_text — generate vector embeddings via POST /api/v1/embeddings.
 *
 * Covers 37+ embedding models on OpenRouter (text-embedding-3-small/large,
 * voyage, Cohere embed, etc.). Useful for RAG pipelines, semantic search,
 * clustering, and classification from within an MCP agent.
 */
import type { OpenRouterAPIClient, EmbeddingsResponse } from '../openrouter-api.js';
import { ErrorCode, toolError } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';

export interface EmbedTextRequest {
  texts: string | string[];
  model?: string;
  dimensions?: number;
}

const DEFAULT_MODEL = 'openai/text-embedding-3-small';
const MAX_TEXTS = 2048; // OpenAI's batch limit

export async function handleEmbedText(
  request: { params: { arguments: EmbedTextRequest } },
  apiClient: OpenRouterAPIClient,
) {
  const args = request.params.arguments ?? ({} as EmbedTextRequest);
  const { texts, model, dimensions } = args;

  // Validate input
  if (texts === undefined || texts === null) {
    return toolError(ErrorCode.INVALID_INPUT, 'texts is required (string or string[]).');
  }

  const inputArray = Array.isArray(texts) ? texts : [texts];
  if (inputArray.length === 0) {
    return toolError(ErrorCode.INVALID_INPUT, 'texts array cannot be empty.');
  }
  if (inputArray.length > MAX_TEXTS) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `Too many texts: ${inputArray.length} exceeds max ${MAX_TEXTS}.`,
    );
  }
  for (let i = 0; i < inputArray.length; i++) {
    if (typeof inputArray[i] !== 'string') {
      return toolError(ErrorCode.INVALID_INPUT, `texts[${i}] must be a string.`);
    }
    if (!inputArray[i]!.trim()) {
      return toolError(ErrorCode.INVALID_INPUT, `texts[${i}] is empty.`);
    }
  }

  if (dimensions !== undefined) {
    if (
      typeof dimensions !== 'number' ||
      !Number.isFinite(dimensions) ||
      !Number.isInteger(dimensions) ||
      dimensions < 1
    ) {
      return toolError(ErrorCode.INVALID_INPUT, 'dimensions must be a positive integer.');
    }
  }

  if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
    return toolError(ErrorCode.INVALID_INPUT, 'model must be a non-empty string.');
  }

  const effectiveModel = model?.trim() || DEFAULT_MODEL;

  logger.audit('embed_text.start', {
    model: effectiveModel,
    text_count: inputArray.length,
    dimensions,
  });

  let response: EmbeddingsResponse;
  try {
    response = await apiClient.createEmbeddings({
      model: effectiveModel,
      input: inputArray,
      dimensions,
    });
  } catch (err) {
    return classifyUpstreamError(err, 'embed_text');
  }

  const embeddings = response.data ?? [];
  if (!embeddings.length) {
    return toolError(ErrorCode.INTERNAL, 'No embeddings returned.', {
      response_keys: Object.keys(response),
    });
  }

  const summary = `Generated ${embeddings.length} embedding(s) with ${embeddings[0]!.embedding.length} dimensions using ${response.model || effectiveModel}.`;

  return {
    content: [{ type: 'text' as const, text: summary }],
    structuredContent: {
      embeddings: embeddings.map((e) => ({
        index: e.index,
        embedding: e.embedding,
      })),
      model: response.model || effectiveModel,
      dimensions: embeddings[0]!.embedding.length,
    },
    _meta: {
      server_version: SERVER_VERSION,
      model: response.model || effectiveModel,
      embedding_count: embeddings.length,
      dimensions: embeddings[0]!.embedding.length,
      ...(response.usage ? { usage: response.usage } : {}),
    },
  };
}
