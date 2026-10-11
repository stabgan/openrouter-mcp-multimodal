import type { OpenRouterAPIClient, RerankResponse } from '../openrouter-api.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { sanitizeUpstreamUsage } from './sanitize-usage.js';
import { buildStructuredResult } from './structured-output.js';
import { capResultText } from './completion-utils.js';

export interface RerankDocumentsRequest {
  query: string;
  documents: string[];
  model?: string;
  top_n?: number;
  /** When true, include the original document text in each result. */
  return_documents?: boolean;
}

const DEFAULT_MODEL = 'cohere/rerank-v3.5';
const MAX_DOCUMENTS = 1000;
/**
 * Model IDs follow the `org/model-name[:suffix]` pattern — 256 chars is
 * generous for any real identifier while preventing multi-megabyte strings
 * from inflating API request bodies, log entries, and MCP responses.
 */
const MAX_MODEL_ID_LENGTH = 256;
/**
 * Per-document and per-query character limits.  Rerank models process
 * short-to-medium text passages; without a ceiling an attacker can send
 * 1 000 multi-megabyte documents, causing memory exhaustion during
 * `JSON.stringify` and the outbound HTTP request.  The 100 K limit
 * matches `embed_text`'s per-element ceiling.
 */
const MAX_DOCUMENT_LENGTH = 100_000;
const MAX_QUERY_LENGTH = 100_000;
/**
 * Aggregate character limit across the query and all documents in a single
 * request.  Per-element limits alone allow 1 000 × 100 000 chars + 100 000
 * query chars ≈ 100 MB of payload, which could cause memory exhaustion
 * during JSON serialisation.  This cap limits the total to ~10 MB — generous
 * for real-world rerank batches while closing the DoS vector.  Mirrors the
 * `MAX_TOTAL_INPUT_CHARS` pattern in the `embed_text` handler.
 */
const MAX_TOTAL_INPUT_CHARS = 10_000_000;

function isValidDocumentIndex(index: unknown, documentCount: number): index is number {
  return (
    typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < documentCount
  );
}

function normalizeRerankResults(
  response: RerankResponse,
  documents: string[],
  returnDocuments: boolean,
  modelFallback: string,
): ReturnType<typeof buildStructuredResult> | ReturnType<typeof toolError> {
  // Cap the number of result entries processed to the number of documents
  // we sent.  The upstream should return at most `documents.length` results
  // (or fewer when top_n is specified), but the response is untrusted — a
  // malformed or compromised upstream could return millions of entries
  // within the 50 MiB JSON response cap (~2 M minimal result objects),
  // causing O(n) memory amplification during `.find()`, `.map()`, and
  // `JSON.stringify` of structuredContent.  Matches the defence-in-depth
  // pattern applied to embed_text (embedding count cap at inputArray.length)
  // and decide (answer count cap at questionNames.length).
  const rawResults = response.results ?? [];
  const results =
    rawResults.length > documents.length ? rawResults.slice(0, documents.length) : rawResults;

  const invalid = results.find((r) => !isValidDocumentIndex(r.index, documents.length));
  if (invalid) {
    return toolError(
      ErrorCode.INTERNAL,
      `Rerank API returned invalid document index ${String(invalid.index)} (expected 0–${documents.length - 1}).`,
    );
  }

  const normalized = results.map((r) => {
    // Guard against non-finite scores from the upstream API. `typeof NaN === 'number'`
    // is true, so a bare typeof check would pass NaN/Infinity through to the MCP
    // response — unusable for downstream consumers. Fall through: score → relevance_score → 0.
    const score =
      typeof r.score === 'number' && Number.isFinite(r.score)
        ? r.score
        : typeof r.relevance_score === 'number' && Number.isFinite(r.relevance_score)
          ? r.relevance_score
          : 0;
    const out: Record<string, unknown> = { index: r.index, score };
    if (returnDocuments) {
      const rawDoc =
        typeof r.document === 'string' ? r.document : (r.document?.text ?? documents[r.index!]);
      const capped = capResultText(rawDoc);
      out.document = capped.text;
      if (capped.truncated) out.document_truncated = true;
    }
    return out;
  });

  // Cap upstream model string — user-supplied model IDs are capped at
  // MAX_MODEL_ID_LENGTH above, but the upstream response echoes a model
  // string that could differ (or be absurdly long in a malformed response).
  // Cap it to the same ceiling used for input validation — matches the
  // pattern already applied in the `embed_text` handler.
  const responseModel = response.model;
  const safeResponseModel =
    typeof responseModel === 'string' && responseModel.length <= MAX_MODEL_ID_LENGTH
      ? responseModel
      : undefined;

  const payload = {
    model: safeResponseModel ?? modelFallback,
    results: normalized,
  };

  const jsonText = JSON.stringify(payload, null, 2);
  const cappedJson = capResultText(jsonText);
  if (cappedJson.truncated) {
    return toolError(
      ErrorCode.RESOURCE_TOO_LARGE,
      'Rerank result exceeds OPENROUTER_MAX_RESULT_TEXT_CHARS. Set it to 0 to disable or raise the limit.',
      { result_truncated: true },
    );
  }

  const safeUsage = sanitizeUpstreamUsage(response.usage);
  return buildStructuredResult(payload, safeUsage ? { usage: safeUsage } : {});
}

export async function handleRerankDocuments(
  request: { params: { arguments: RerankDocumentsRequest } },
  apiClient: OpenRouterAPIClient,
) {
  const args = request.params.arguments ?? ({ query: '', documents: [] } as RerankDocumentsRequest);
  const { query, documents, model, top_n, return_documents } = args;

  if (typeof query !== 'string' || !query.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'query is required.');
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `query exceeds max length ${MAX_QUERY_LENGTH} (got ${query.length}).`,
    );
  }
  if (!Array.isArray(documents) || documents.length === 0) {
    return toolError(ErrorCode.INVALID_INPUT, 'documents must be a non-empty array of strings.');
  }
  if (documents.length > MAX_DOCUMENTS) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `documents has ${documents.length} entries — max ${MAX_DOCUMENTS}.`,
    );
  }
  for (let i = 0; i < documents.length; i++) {
    if (typeof documents[i] !== 'string' || !documents[i]!.trim()) {
      return toolError(ErrorCode.INVALID_INPUT, `documents[${i}] must be a non-empty string.`);
    }
    if (documents[i]!.length > MAX_DOCUMENT_LENGTH) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `documents[${i}] exceeds max length ${MAX_DOCUMENT_LENGTH} (got ${documents[i]!.length}).`,
      );
    }
  }
  // Aggregate size guard — per-element limits alone allow 1 000 × 100 K chars
  // ≈ 100 MB, which could cause memory exhaustion during JSON.stringify.
  const totalChars = query.length + documents.reduce((sum, d) => sum + d.length, 0);
  if (totalChars > MAX_TOTAL_INPUT_CHARS) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `Total input size (${totalChars} chars) exceeds max ${MAX_TOTAL_INPUT_CHARS}. Reduce the number or length of documents.`,
    );
  }
  // Validate model type — MCP clients that ignore the JSON schema can send
  // numbers or booleans. Without this guard `model?.trim()` throws TypeError
  // on non-string values (e.g. `model: 42` → `(42).trim()` crashes), caught
  // by the router as a confusing INTERNAL error. Matches the type checks
  // applied to query, provider, and capabilities in search_models.
  if (model !== undefined && typeof model !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'model must be a string.');
  }
  if (typeof model === 'string' && model.length > MAX_MODEL_ID_LENGTH) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `model identifier exceeds max length ${MAX_MODEL_ID_LENGTH} (got ${model.length}).`,
    );
  }
  // Validate return_documents type — the handler uses `=== true` for strict
  // boolean comparison, so non-boolean truthy values like `"true"` or `1`
  // are silently treated as false, causing the caller to not receive
  // documents without any error. Reject wrong types explicitly instead.
  if (return_documents !== undefined && typeof return_documents !== 'boolean') {
    return toolError(ErrorCode.INVALID_INPUT, 'return_documents must be a boolean.');
  }
  if (top_n !== undefined) {
    if (typeof top_n !== 'number' || !Number.isFinite(top_n) || !Number.isInteger(top_n)) {
      return toolError(ErrorCode.INVALID_INPUT, 'top_n must be a positive integer.');
    }
    if (top_n < 1) {
      return toolError(ErrorCode.INVALID_INPUT, 'top_n must be at least 1 when specified.');
    }
  }

  const effectiveModel = model?.trim() || DEFAULT_MODEL;

  let response: RerankResponse;
  try {
    response = await apiClient.rerank({
      model: effectiveModel,
      query,
      documents,
      top_n,
      return_documents: return_documents === true ? true : undefined,
    });
  } catch (err) {
    return classifyUpstreamError(err, 'rerank');
  }

  try {
    return normalizeRerankResults(response, documents, return_documents === true, effectiveModel);
  } catch (err) {
    return toolErrorFrom(ErrorCode.INTERNAL, err, 'rerank');
  }
}
