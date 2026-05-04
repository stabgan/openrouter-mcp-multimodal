import type { OpenRouterAPIClient, RerankResponse } from '../openrouter-api.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildStructuredResult } from './structured-output.js';

export interface RerankDocumentsRequest {
  query: string;
  documents: string[];
  model?: string;
  top_n?: number;
  /** When true, include the original document text in each result. */
  return_documents?: boolean;
}

const DEFAULT_MODEL = 'cohere/rerank-english-v3.0';

export async function handleRerankDocuments(
  request: { params: { arguments: RerankDocumentsRequest } },
  apiClient: OpenRouterAPIClient,
) {
  const args =
    request.params.arguments ??
    ({ query: '', documents: [] } as RerankDocumentsRequest);
  const { query, documents, model, top_n, return_documents } = args;

  if (!query?.trim()) {
    return toolError(ErrorCode.INVALID_INPUT, 'query is required.');
  }
  if (!Array.isArray(documents) || documents.length === 0) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      'documents must be a non-empty array of strings.',
    );
  }
  if (documents.some((d) => typeof d !== 'string')) {
    return toolError(ErrorCode.INVALID_INPUT, 'every document must be a string.');
  }

  let response: RerankResponse;
  try {
    response = await apiClient.rerank({
      model: model || DEFAULT_MODEL,
      query,
      documents,
      top_n,
    });
  } catch (err) {
    return classifyUpstreamError(err, 'rerank');
  }

  // Normalize to a stable shape: always expose `score` (OpenRouter
  // providers sometimes return `relevance_score`, sometimes `score`).
  const normalized = (response.results ?? []).map((r) => {
    const score = typeof r.score === 'number' ? r.score : r.relevance_score;
    const out: Record<string, unknown> = { index: r.index, score };
    if (return_documents) {
      const doc =
        typeof r.document === 'string'
          ? r.document
          : r.document?.text ?? documents[r.index];
      out.document = doc;
    }
    return out;
  });

  try {
    return buildStructuredResult(
      {
        model: response.model ?? model ?? DEFAULT_MODEL,
        results: normalized,
      },
      response.usage ? { usage: response.usage } : {},
    );
  } catch (err) {
    return toolErrorFrom(ErrorCode.INTERNAL, err, 'rerank');
  }
}
