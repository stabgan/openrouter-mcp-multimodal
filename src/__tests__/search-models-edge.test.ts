import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSearchModels } from '../tool-handlers/search-models.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

const apiClient = {
  getModels: vi.fn().mockResolvedValue([]),
} as unknown as OpenRouterAPIClient;

describe('search_models edge cases', () => {
  beforeEach(() => {
    const cache = ModelCache.getInstance();
    cache.reset();
    cache.setModels(
      Array.from({ length: 30 }, (_, i) => ({
        id: `openai/test-${String(i).padStart(2, '0')}`,
        name: `Test ${i}`,
        architecture: { input_modalities: ['text'] },
      })),
    );
  });

  it('returns empty results array when offset past total', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { offset: 100, limit: 10 } } },
      apiClient,
      ModelCache.getInstance(),
    );
    const sc = (r as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect(sc?.results).toEqual([]);
    expect(sc?.total).toBe(30);
    expect(sc?.has_more).toBe(false);
    expect(sc?.next_offset).toBeNull();
  });

  it('clamps negative offset to zero', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { offset: -10, limit: 5 } } },
      apiClient,
      ModelCache.getInstance(),
    );
    const sc = (r as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect((sc?.results as unknown[]).length).toBe(5);
    expect(sc?.offset).toBe(0);
  });

  it('sets has_more and next_offset on partial last page', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { offset: 25, limit: 10 } } },
      apiClient,
      ModelCache.getInstance(),
    );
    const sc = (r as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect((sc?.results as unknown[]).length).toBe(5);
    expect(sc?.has_more).toBe(false);
    expect(sc?.next_offset).toBeNull();
  });
});
