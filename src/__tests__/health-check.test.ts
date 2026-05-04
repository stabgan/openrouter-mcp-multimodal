import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleHealthCheck } from '../tool-handlers/health-check.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { SERVER_VERSION, MCP_PROTOCOL_VERSION } from '../version.js';

function resetCache(): ModelCache {
  const cache = ModelCache.getInstance();
  cache.reset();
  return cache;
}

describe('handleHealthCheck', () => {
  beforeEach(() => resetCache());

  it('returns ok=true when API call and cache succeed', async () => {
    const cache = resetCache();
    const apiClient = {
      getModels: vi.fn().mockResolvedValue([
        { id: 'model-1' },
        { id: 'model-2' },
      ]),
    } as unknown as OpenRouterAPIClient;
    const r = await handleHealthCheck({ params: { arguments: {} } }, apiClient, cache);
    const sc = (r as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc).toMatchObject({
      ok: true,
      server_version: SERVER_VERSION,
      protocol_version: MCP_PROTOCOL_VERSION,
      api_key_valid: true,
      models_cached: 2,
    });
  });

  it('returns ok=false when API key is invalid', async () => {
    const cache = resetCache();
    const apiClient = {
      getModels: vi.fn().mockRejectedValue(new Error('HTTP 401')),
    } as unknown as OpenRouterAPIClient;
    const r = await handleHealthCheck({ params: { arguments: {} } }, apiClient, cache);
    const sc = (r as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc.ok).toBe(false);
    expect(sc.api_key_valid).toBe(false);
    expect(sc.error).toMatch(/HTTP 401/);
  });

  it('returns ok=true with models_cached=0 on successful-but-empty catalog', async () => {
    // v4.5.0 contract: `ok` tracks API reachability, not catalog size.
    // A successful fetch that happens to return [] still counts as `ok: true`.
    const cache = resetCache();
    const apiClient = {
      getModels: vi.fn().mockResolvedValue([]),
    } as unknown as OpenRouterAPIClient;
    const r = await handleHealthCheck({ params: { arguments: {} } }, apiClient, cache);
    const sc = (r as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc.ok).toBe(true);
    expect(sc.api_key_valid).toBe(true);
    expect(sc.models_cached).toBe(0);
  });

  it('does not hot-loop re-fetching after a successful-but-empty response', async () => {
    // Regression test for the "empty catalog → isValid() false → hot loop"
    // bug found by the v4.5.0 bug-hunter audit.
    const cache = resetCache();
    const getModels = vi.fn().mockResolvedValue([]);
    const apiClient = { getModels } as unknown as OpenRouterAPIClient;
    await handleHealthCheck({ params: { arguments: {} } }, apiClient, cache);
    await handleHealthCheck({ params: { arguments: {} } }, apiClient, cache);
    await handleHealthCheck({ params: { arguments: {} } }, apiClient, cache);
    expect(getModels).toHaveBeenCalledTimes(1);
  });

  it('emits structuredContent with required fields', async () => {
    const cache = resetCache();
    const apiClient = {
      getModels: vi.fn().mockResolvedValue([{ id: 'only' }]),
    } as unknown as OpenRouterAPIClient;
    const r = await handleHealthCheck({ params: { arguments: {} } }, apiClient, cache);
    const sc = (r as { structuredContent: Record<string, unknown> }).structuredContent;
    for (const key of [
      'ok',
      'server_version',
      'protocol_version',
      'api_key_valid',
      'models_cached',
    ]) {
      expect(sc).toHaveProperty(key);
    }
  });

  it('reports server + protocol version regardless of API health', async () => {
    const cache = resetCache();
    const apiClient = {
      getModels: vi.fn().mockRejectedValue(new Error('unreachable')),
    } as unknown as OpenRouterAPIClient;
    const r = await handleHealthCheck({ params: { arguments: {} } }, apiClient, cache);
    const sc = (r as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc.server_version).toBe(SERVER_VERSION);
    expect(sc.protocol_version).toBe(MCP_PROTOCOL_VERSION);
  });
});
