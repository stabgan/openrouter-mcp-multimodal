import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { ModelCache } from '../model-cache.js';
import { SERVER_VERSION, MCP_PROTOCOL_VERSION } from '../version.js';
import { buildStructuredResult } from './structured-output.js';

/**
 * Lightweight liveness probe. Runs the following checks:
 *  - Hit `/models` via the API client (indirectly validates API key +
 *    OpenRouter reachability)
 *  - Read cached model count
 *  - Report server + protocol versions
 *
 * Returns `{ ok, ... }` so ops can use it as a readiness signal.
 */
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
  // `ok` means the API was reachable and the key was accepted. An empty
  // catalog counts as success (the API just returned no models) — callers
  // branch on `models_cached` if they care about the count.
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
