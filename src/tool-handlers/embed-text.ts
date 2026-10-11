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
import { sanitizeUpstreamUsage } from './sanitize-usage.js';

export interface EmbedTextRequest {
  texts: string | string[];
  model?: string;
  dimensions?: number;
}

const DEFAULT_MODEL = 'openai/text-embedding-3-small';
/**
 * Model IDs follow the `org/model-name[:suffix]` pattern — 256 chars is
 * generous for any real identifier while preventing multi-megabyte strings
 * from inflating API request bodies, log entries, and MCP responses.
 * Matches the MAX_QUESTION_NAME_LENGTH ceiling in the `decide` handler.
 */
const MAX_MODEL_ID_LENGTH = 256;
const MAX_TEXTS = 2048; // OpenAI's batch limit
/**
 * Per-text character limit.  text-embedding-3-large accepts ~8 191 tokens
 * ≈ 32 KiB of English; set the ceiling higher to cover multi-byte scripts
 * but still prevent multi-megabyte payloads from a single element.
 */
const MAX_TEXT_LENGTH = 100_000;
/**
 * Maximum number of dimensions per embedding vector accepted from the
 * upstream response.  User input validation caps the `dimensions` *request*
 * parameter at 65 536, but the upstream *response* was not bounded —
 * a malformed or compromised upstream could return vectors with millions of
 * elements, causing memory amplification during the `.map()` sanitization
 * and `JSON.stringify` of `structuredContent`.  The ceiling matches the
 * user-input cap so input and output limits are consistent.
 */
const MAX_RESPONSE_EMBEDDING_DIMENSIONS = 65_536;
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
  if (typeof model === 'string' && model.length > MAX_MODEL_ID_LENGTH) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `model identifier exceeds max length ${MAX_MODEL_ID_LENGTH} (got ${model.length}).`,
    );
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

  const rawEmbeddings = response.data ?? [];
  if (!Array.isArray(rawEmbeddings) || !rawEmbeddings.length) {
    return toolError(ErrorCode.INTERNAL, 'No embeddings returned.', {
      response_keys: Object.keys(response),
    });
  }

  // Cap the number of embedding objects processed to the number of texts
  // we sent.  The upstream should return exactly `inputArray.length`
  // embeddings, but the response is untrusted — a malformed or
  // compromised upstream could return arbitrarily many objects, each with
  // thousands of dimensions, causing memory exhaustion during the
  // sanitization map and an oversized MCP response.  Matches the
  // defence-in-depth pattern: user inputs are bounded (MAX_TEXTS) and
  // upstream response counts are bounded to match.
  const embeddings =
    rawEmbeddings.length > inputArray.length
      ? rawEmbeddings.slice(0, inputArray.length)
      : rawEmbeddings;

  // Defensive: verify the first element has the expected shape before
  // accessing `.embedding.length`.  A malformed upstream response would
  // otherwise throw an unclassified TypeError.
  const first = embeddings[0];
  if (!first || !Array.isArray(first.embedding) || first.embedding.length === 0) {
    return toolError(ErrorCode.INTERNAL, 'Embeddings response has unexpected shape.', {
      first_element_keys: first ? Object.keys(first) : [],
    });
  }

  // Sanitize upstream response — allowlist expected fields on every
  // embedding element before forwarding to MCP clients.  Input validation
  // rejects malformed user input, but the upstream API response is
  // untrusted.  The previous selective map `{ index: e.index, embedding:
  // e.embedding }` picked the right keys but did not validate their
  // *types*:
  //
  //   - `index` was forwarded without checking it is a non-negative
  //     integer — a string, NaN, or negative value would cause type
  //     confusion in downstream consumers that use it for array indexing.
  //   - `embedding` elements were forwarded without checking they are
  //     finite numbers — NaN or Infinity values silently produce garbage
  //     results in dot-product / cosine-similarity calculations, and
  //     non-number elements (strings, objects, null) cause TypeErrors.
  //   - `response.model` was forwarded without a length cap — a
  //     malformed upstream response with a multi-megabyte model string
  //     would inflate both the text summary and structuredContent.
  //
  // This sanitization mirrors the allowlist approach in the `decide`
  // handler, which validates every field type before including it in
  // structuredContent.
  const sanitizedEmbeddings = embeddings.map((e, i) => {
    const safeIndex =
      typeof e.index === 'number' && Number.isInteger(e.index) && e.index >= 0 ? e.index : i;
    const rawEmbedding = Array.isArray(e.embedding) ? e.embedding : [];
    // Cap per-vector dimension count — input validation caps the requested
    // `dimensions` at 65 536, but the upstream response is untrusted.
    // Without this cap, a malformed upstream could return vectors with
    // millions of elements, causing O(n) memory amplification during
    // `.map()` and `JSON.stringify` of structuredContent.
    const bounded =
      rawEmbedding.length > MAX_RESPONSE_EMBEDDING_DIMENSIONS
        ? rawEmbedding.slice(0, MAX_RESPONSE_EMBEDDING_DIMENSIONS)
        : rawEmbedding;
    const safeEmbedding = bounded.map((v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? v : 0,
    );
    return { index: safeIndex, embedding: safeEmbedding };
  });

  // Cap upstream model string — user-supplied model IDs are capped at
  // MAX_MODEL_ID_LENGTH above, but the upstream response echoes a model
  // string that could differ (or be absurdly long in a malformed
  // response).  Cap it to the same ceiling used for input validation.
  const responseModel = response.model;
  const safeResponseModel =
    typeof responseModel === 'string' && responseModel.length <= MAX_MODEL_ID_LENGTH
      ? responseModel
      : undefined;
  const displayModel = safeResponseModel || effectiveModel;

  // Sanitize usage — only forward known numeric fields.  The raw upstream
  // `response.usage` object is untrusted and could contain prototype-
  // pollution keys or arbitrarily large nested structures that inflate the
  // MCP response.  Uses the shared sanitizer applied consistently across
  // all handlers that surface upstream usage data.
  const safeUsage = sanitizeUpstreamUsage(response.usage);

  // Use the sanitized dimension count — the raw upstream `first.embedding.length`
  // may exceed `MAX_RESPONSE_EMBEDDING_DIMENSIONS` if the upstream returned
  // oversized vectors.  The sanitized embeddings are correctly capped, but
  // metadata must report the *actual* dimensions in the output — not the
  // uncapped upstream value.  A downstream consumer that allocates arrays
  // based on the reported `dimensions` count would otherwise allocate based
  // on an inflated value, enabling memory amplification from a malformed
  // upstream response.
  const sanitizedDimensions = sanitizedEmbeddings[0]!.embedding.length;

  const summary = `Generated ${sanitizedEmbeddings.length} embedding(s) with ${sanitizedDimensions} dimensions using ${displayModel}.`;

  return {
    content: [{ type: 'text' as const, text: summary }],
    structuredContent: {
      embeddings: sanitizedEmbeddings,
      model: displayModel,
      dimensions: sanitizedDimensions,
    },
    _meta: {
      server_version: SERVER_VERSION,
      model: displayModel,
      embedding_count: sanitizedEmbeddings.length,
      dimensions: sanitizedDimensions,
      ...(safeUsage ? { usage: safeUsage } : {}),
    },
  };
}
