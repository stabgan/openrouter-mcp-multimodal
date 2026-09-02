import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSearchModels } from '../tool-handlers/search-models.js';
import { handleValidateModel } from '../tool-handlers/validate-model.js';
import { handleGetModelInfo } from '../tool-handlers/get-model-info.js';
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

  it('floors fractional offset and limit', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { offset: 0.7, limit: 5.9 } } },
      apiClient,
      ModelCache.getInstance(),
    );
    const sc = (r as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect((sc?.results as unknown[]).length).toBe(5);
    expect(sc?.offset).toBe(0);
    expect(sc?.limit).toBe(5);
  });

  it('returns empty results for query matching nothing', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { query: 'zzzz-no-match-zzzz' } } },
      apiClient,
      ModelCache.getInstance(),
    );
    const sc = (r as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect(sc?.results).toEqual([]);
    expect(sc?.total).toBe(0);
    expect(sc?.has_more).toBe(false);
  });

  it('validate_model accepts routing suffix when base slug is in catalog', async () => {
    const cache = ModelCache.getInstance();
    cache.setModels([{ id: 'openai/gpt-4o' }]);
    const r = await handleValidateModel(
      { params: { arguments: { model: 'openai/gpt-4o:nitro' } } },
      cache,
    );
    expect((r as { structuredContent?: { valid: boolean } }).structuredContent?.valid).toBe(true);
  });

  it('get_model_info resolves routing suffix to catalog record', async () => {
    const cache = ModelCache.getInstance();
    cache.setModels([{ id: 'anthropic/claude-sonnet-4', name: 'Claude' }]);
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'anthropic/claude-sonnet-4:exacto' } } },
      cache,
    );
    const sc = (r as { structuredContent?: { id: string } }).structuredContent;
    expect(sc?.id).toBe('anthropic/claude-sonnet-4');
  });
});
