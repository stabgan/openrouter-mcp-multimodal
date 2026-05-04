import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSearchModels } from '../tool-handlers/search-models.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

function makeModels(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `provider/model-${i.toString().padStart(3, '0')}`,
    name: `Model ${i}`,
  }));
}

describe('search_models pagination', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.setModels(makeModels(30));
  });

  const apiClient = {
    getModels: vi.fn().mockResolvedValue(makeModels(30)),
  } as unknown as OpenRouterAPIClient;

  it('returns first page by default', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { limit: 10 } } },
      apiClient,
      cache,
    );
    const sc = (r as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(Array.isArray(sc.results)).toBe(true);
    expect((sc.results as unknown[]).length).toBe(10);
    expect(sc.offset).toBe(0);
    expect(sc.limit).toBe(10);
    expect(sc.total).toBe(30);
    expect(sc.has_more).toBe(true);
    expect(sc.next_offset).toBe(10);
  });

  it('respects offset to return subsequent pages', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { limit: 10, offset: 20 } } },
      apiClient,
      cache,
    );
    const sc = (r as { structuredContent: Record<string, unknown> }).structuredContent;
    expect((sc.results as Array<{ id: string }>)[0].id).toContain('model-020');
    expect(sc.has_more).toBe(false);
    expect(sc.next_offset).toBeNull();
  });

  it('caps limit at 50', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { limit: 500 } } },
      apiClient,
      cache,
    );
    const sc = (r as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc.limit).toBe(50);
  });

  it('floors offset at 0', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { offset: -10 } } },
      apiClient,
      cache,
    );
    const sc = (r as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc.offset).toBe(0);
  });

  it('reports has_more=false on the last exact page', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { limit: 10, offset: 20 } } },
      apiClient,
      cache,
    );
    const sc = (r as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc.has_more).toBe(false);
    expect(sc.next_offset).toBeNull();
  });
});
