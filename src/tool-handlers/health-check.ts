import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { ModelCache } from '../model-cache.js';
import { SERVER_VERSION, MCP_PROTOCOL_VERSION } from '../version.js';
import { buildStructuredResult } from './structured-output.js';

/** Liveness probe — validates API key, reachability, and cached model count. */
export async function handleHealthCheck(
  _request: { params: { arguments: Record<string, unknown> } },
  apiClient: OpenRouterAPIClient,
  modelCache: ModelCache,
) {
  let apiKeyValid = false;
  let errorMessage: string | undefined;
  try {
    await modelCache.ensureFresh(() => apiClient.getModels());
    apiKeyValid = true;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const modelsCached = modelCache.isValid() ? modelCache.size() : 0;
  const ok = apiKeyValid;

  return buildStructuredResult({
    ok,
    server_version: SERVER_VERSION,
    protocol_version: MCP_PROTOCOL_VERSION,
    api_key_valid: apiKeyValid,
    models_cached: modelsCached,
    ...(errorMessage ? { error: errorMessage } : {}),
  });
}
