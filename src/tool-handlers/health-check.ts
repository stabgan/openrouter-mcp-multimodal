import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { ModelCache } from '../model-cache.js';
import { SERVER_VERSION, MCP_PROTOCOL_VERSION } from '../version.js';
import { buildStructuredResult } from './structured-output.js';
import { classifyUpstreamError } from './openrouter-errors.js';

/** Liveness probe — validates API key, reachability, and cached model count. */
export async function handleHealthCheck(
  _request: { params: { arguments: Record<string, unknown> } },
  apiClient: OpenRouterAPIClient,
  modelCache: ModelCache,
) {
  try {
    let apiKeyValid = false;
    let errorMessage: string | undefined;
    let errorMeta: Record<string, unknown> = {};
    try {
      await modelCache.ensureFresh(() => apiClient.getModels());
      apiKeyValid = true;
    } catch (err) {
      const classified = classifyUpstreamError(err, 'health_check');
      errorMessage = classified.content[0]?.text;
      errorMeta = {
        code: classified._meta.code,
        ...(classified._meta.suggestions ? { suggestions: classified._meta.suggestions } : {}),
        ...(classified._meta.details ? { details: classified._meta.details } : {}),
      };
    }

    const modelsCached = modelCache.isValid() ? modelCache.size() : 0;
    const ok = apiKeyValid;

    return buildStructuredResult(
      {
        ok,
        server_version: SERVER_VERSION,
        protocol_version: MCP_PROTOCOL_VERSION,
        api_key_valid: apiKeyValid,
        models_cached: modelsCached,
        ...(errorMessage ? { error: errorMessage } : {}),
      },
      errorMeta,
    );
  } catch (err) {
    const classified = classifyUpstreamError(err, 'health_check');
    return buildStructuredResult(
      {
        ok: false,
        server_version: SERVER_VERSION,
        protocol_version: MCP_PROTOCOL_VERSION,
        api_key_valid: false,
        models_cached: 0,
        error: classified.content[0]?.text,
      },
      {
        code: classified._meta.code,
        ...(classified._meta.suggestions ? { suggestions: classified._meta.suggestions } : {}),
      },
    );
  }
}
