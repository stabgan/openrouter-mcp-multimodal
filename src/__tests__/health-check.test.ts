import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleHealthCheck } from '../tool-handlers/health-check.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { SERVER_VERSION, MCP_PROTOCOL_VERSION } from '../version.js';

function resetCache(): ModelCache {
  const cache = ModelCache.getInstance();
  cache.setModels([]);
  (cache as unknown as { fetchedAt: number }).fetchedAt = 0;
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
