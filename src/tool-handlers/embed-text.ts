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
/**
 * Per-text character limit.  text-embedding-3-large accepts ~8 191 tokens
 * ≈ 32 KiB of English; set the ceiling higher to cover multi-byte scripts
 * but still prevent multi-megabyte payloads from a single element.
 */
const MAX_TEXT_LENGTH = 100_000;
/**
 * Aggregate character limit across all texts in a single request.
 * Per-text limits alone allow 2 048 × 100 000 chars ≈ 200 MB of payload,
 * which could cause memory exhaustion during JSON serialisation.  This cap
 * limits the total to ~10 MB of text — generous for real-world embedding
 * batches while closing the DoS vector.  Mirrors the `MAX_STATE_BYTES`
 * pattern in the `decide` handler.
 */
const MAX_TOTAL_INPUT_CHARS = 10_000_000;

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
  let totalChars = 0;
  for (let i = 0; i < inputArray.length; i++) {
    if (typeof inputArray[i] !== 'string') {
      return toolError(ErrorCode.INVALID_INPUT, `texts[${i}] must be a string.`);
    }
    if (!inputArray[i]!.trim()) {
      return toolError(ErrorCode.INVALID_INPUT, `texts[${i}] is empty.`);
    }
    if (inputArray[i]!.length > MAX_TEXT_LENGTH) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `texts[${i}] exceeds max length ${MAX_TEXT_LENGTH} (got ${inputArray[i]!.length}).`,
      );
    }
    totalChars += inputArray[i]!.length;
  }
  if (totalChars > MAX_TOTAL_INPUT_CHARS) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `Total input size (${totalChars} chars) exceeds max ${MAX_TOTAL_INPUT_CHARS}. Reduce the number or length of texts.`,
    );
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
    if (dimensions > 65536) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `dimensions ${dimensions} exceeds max 65536. No known embedding model supports more.`,
      );
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
  if (!Array.isArray(embeddings) || !embeddings.length) {
    return toolError(ErrorCode.INTERNAL, 'No embeddings returned.', {
      response_keys: Object.keys(response),
    });
  }

  // Defensive: verify the first element has the expected shape before
  // accessing `.embedding.length`.  A malformed upstream response would
  // otherwise throw an unclassified TypeError.
  const first = embeddings[0];
  if (!first || !Array.isArray(first.embedding) || first.embedding.length === 0) {
    return toolError(ErrorCode.INTERNAL, 'Embeddings response has unexpected shape.', {
      first_element_keys: first ? Object.keys(first) : [],
    });
  }

  const summary = `Generated ${embeddings.length} embedding(s) with ${first.embedding.length} dimensions using ${response.model || effectiveModel}.`;

  return {
    content: [{ type: 'text' as const, text: summary }],
    structuredContent: {
      embeddings: embeddings.map((e) => ({
        index: e.index,
        embedding: e.embedding,
      })),
      model: response.model || effectiveModel,
      dimensions: first.embedding.length,
    },
    _meta: {
      server_version: SERVER_VERSION,
      model: response.model || effectiveModel,
      embedding_count: embeddings.length,
      dimensions: first.embedding.length,
      ...(response.usage ? { usage: response.usage } : {}),
    },
  };
}
