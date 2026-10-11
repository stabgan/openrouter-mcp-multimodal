import {
  ModelCache,
  clampLimit,
  clampOffset,
  MAX_SEARCH_LIMIT,
  sanitizeModelRecordForOutput,
} from '../model-cache.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import { buildStructuredResult } from './structured-output.js';

export interface SearchModelsArgs {
  query?: string;
  provider?: string;
  capabilities?: { vision?: boolean; audio?: boolean; video?: boolean };
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 20;

/**
 * Maximum length for query and provider filter strings.  `buildMatcher()`
 * lowercases the query and runs `.includes()` against every model in the
 * catalog (400+ entries).  A multi-megabyte string causes O(n × len)
 * substring searches — an easy denial-of-service vector.  256 chars is
 * generous for any real model ID, name substring, or provider slug.
 * Matches MAX_MODEL_ID_LENGTH used by every other handler.
 */
const MAX_QUERY_LENGTH = 256;
const MAX_PROVIDER_LENGTH = 256;

/** Keys that could cause prototype pollution when iterated with Object.entries/for-in. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export async function handleSearchModels(
  request: { params: { arguments: SearchModelsArgs } },
  apiClient: OpenRouterAPIClient,
  modelCache: ModelCache,
) {
  const args = request.params.arguments ?? {};

  // Validate param types — MCP clients that ignore the JSON schema can
  // send numbers, booleans, or other types. Without these guards the handler
  // either silently falls back to defaults (confusing) or crashes with a
  // TypeError when buildMatcher() calls .trim() on a non-string value.
  // Matches the explicit typeof checks used by every other handler
  // (chat_completion, generate_video, rerank, etc.).
  if (args.query !== undefined && typeof args.query !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'query must be a string.');
  }
  if (typeof args.query === 'string' && args.query.length > MAX_QUERY_LENGTH) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `query exceeds max length ${MAX_QUERY_LENGTH} (got ${args.query.length}). Use a shorter search term.`,
    );
  }
  if (args.provider !== undefined && typeof args.provider !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'provider must be a string.');
  }
  if (typeof args.provider === 'string' && args.provider.length > MAX_PROVIDER_LENGTH) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `provider exceeds max length ${MAX_PROVIDER_LENGTH} (got ${args.provider.length}).`,
    );
  }
  if (
    args.capabilities !== undefined &&
    (typeof args.capabilities !== 'object' ||
      args.capabilities === null ||
      Array.isArray(args.capabilities))
  ) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      'capabilities must be an object (e.g. { "vision": true }).',
    );
  }
  // Block prototype-pollution keys in capabilities — matches guards in
  // decide (questions/state), provider-routing, and logger. Although
  // capabilities is only accessed via .vision/.audio/.video with strict
  // boolean comparison, the guard maintains defense-in-depth consistency
  // with every other user-supplied object in the codebase.
  if (args.capabilities !== undefined) {
    for (const key of Object.keys(args.capabilities)) {
      if (UNSAFE_KEYS.has(key)) {
        return toolError(ErrorCode.INVALID_INPUT, `capabilities contains unsafe key "${key}".`);
      }
    }
  }
  // Range clamping is handled by clampLimit/clampOffset.
  if (args.limit !== undefined) {
    if (typeof args.limit !== 'number' || !Number.isFinite(args.limit)) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `limit must be a number (integer 1–${MAX_SEARCH_LIMIT}).`,
      );
    }
  }
  if (args.offset !== undefined) {
    if (typeof args.offset !== 'number' || !Number.isFinite(args.offset)) {
      return toolError(ErrorCode.INVALID_INPUT, 'offset must be a non-negative integer.');
    }
  }

  try {
    await modelCache.ensureFresh(() => apiClient.getModels());
  } catch (error: unknown) {
    return classifyUpstreamError(error, 'search_models');
  }
  try {
    const limit = clampLimit(args.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT);
    const offset = clampOffset(args.offset ?? 0);

    const { page, total } = modelCache.searchPaginated(
      {
        query: args.query,
        provider: args.provider,
        capabilities: args.capabilities,
      },
      offset,
      limit,
    );
    const nextOffset = offset + limit;
    const hasMore = nextOffset < total;

    return buildStructuredResult({
      results: page.map(sanitizeModelRecordForOutput),
      offset,
      limit,
      total,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : null,
    });
  } catch (error: unknown) {
    return toolErrorFrom(ErrorCode.INTERNAL, error, 'search_models');
  }
}
