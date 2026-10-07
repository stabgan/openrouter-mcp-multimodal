import type { OpenRouterAPIClient, RerankResponse } from '../openrouter-api.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { classifyUpstreamError } from './openrouter-errors.js';
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
  const invalid = (response.results ?? []).find(
    (r) => !isValidDocumentIndex(r.index, documents.length),
  );
  if (invalid) {
    return toolError(
      ErrorCode.INTERNAL,
      `Rerank API returned invalid document index ${String(invalid.index)} (expected 0–${documents.length - 1}).`,
    );
  }

  const normalized = (response.results ?? []).map((r) => {
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

  const payload = {
    model: response.model ?? modelFallback,
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

  return buildStructuredResult(payload, response.usage ? { usage: response.usage } : {});
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
  if (!Array.isArray(documents) || documents.length === 0) {
    return toolError(ErrorCode.INVALID_INPUT, 'documents must be a non-empty array of strings.');
  }
  if (documents.some((d) => typeof d !== 'string' || !d.trim())) {
    return toolError(ErrorCode.INVALID_INPUT, 'every document must be a non-empty string.');
  }
  if (documents.length > MAX_DOCUMENTS) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `documents has ${documents.length} entries — max ${MAX_DOCUMENTS}.`,
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
