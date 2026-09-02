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

const DEFAULT_MODEL = 'cohere/rerank-english-v3.0';

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
    const score = typeof r.score === 'number' ? r.score : r.relevance_score;
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

  if (!query?.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'query is required.');
  }
  if (!Array.isArray(documents) || documents.length === 0) {
    return toolError(ErrorCode.INVALID_INPUT, 'documents must be a non-empty array of strings.');
  }
  if (documents.some((d) => typeof d !== 'string')) {
    return toolError(ErrorCode.INVALID_INPUT, 'every document must be a string.');
  }
  if (top_n !== undefined) {
    if (typeof top_n !== 'number' || !Number.isFinite(top_n)) {
      return toolError(ErrorCode.INVALID_INPUT, 'top_n must be a finite number.');
    }
    if (top_n < 1) {
      return toolError(ErrorCode.INVALID_INPUT, 'top_n must be at least 1 when specified.');
    }
  }

  const effectiveModel = model || DEFAULT_MODEL;

  let response: RerankResponse;
  try {
    response = await apiClient.rerank({
      model: effectiveModel,
      query,
      documents,
      top_n,
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
