import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleValidateModel } from '../tool-handlers/validate-model.js';
import { handleGetModelInfo } from '../tool-handlers/get-model-info.js';
import { handleSearchModels } from '../tool-handlers/search-models.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

function resetCacheWith(models: Array<{ id: string; name?: string }>): ModelCache {
  const cache = ModelCache.getInstance();
  cache.setModels(models);
  return cache;
}

const apiClient = {
  getModels: vi.fn().mockResolvedValue([]),
} as unknown as OpenRouterAPIClient;

describe('data-returning tools emit structuredContent', () => {
  beforeEach(() => {
    resetCacheWith([
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
    ]);
  });

  it('validate_model emits { valid, model }', async () => {
    const cache = ModelCache.getInstance();
    const r = await handleValidateModel(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    expect(
      (r as { structuredContent?: { valid: boolean; model: string } }).structuredContent,
    ).toEqual({ valid: true, model: 'openai/gpt-4o' });
  });

  it('validate_model returns valid:false for unknown models', async () => {
    const cache = ModelCache.getInstance();
    const r = await handleValidateModel(
      { params: { arguments: { model: 'imaginary/model' } } },
      cache,
    );
    expect(
      (r as { structuredContent?: { valid: boolean } }).structuredContent?.valid,
    ).toBe(false);
  });

  it('get_model_info emits the full record', async () => {
    const cache = ModelCache.getInstance();
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'anthropic/claude-sonnet-4' } } },
      cache,
    );
    const sc = (r as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect(sc?.id).toBe('anthropic/claude-sonnet-4');
    expect(sc?.name).toBe('Claude Sonnet 4');
  });

  it('get_model_info errors cleanly on unknown model', async () => {
    const cache = ModelCache.getInstance();
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'ghost/model' } } },
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('MODEL_NOT_FOUND');
  });

  it('search_models emits paginated structured output', async () => {
    const cache = ModelCache.getInstance();
    const r = await handleSearchModels(
      { params: { arguments: {} } },
      apiClient,
      cache,
    );
    const sc = (r as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect(sc).toBeDefined();
    expect(sc).toHaveProperty('results');
    expect(sc).toHaveProperty('offset');
    expect(sc).toHaveProperty('total');
    expect(sc).toHaveProperty('has_more');
  });

  it('both content[0].text and structuredContent carry the same data', async () => {
    const cache = ModelCache.getInstance();
    const r = await handleValidateModel(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    const sc = (r as { structuredContent: unknown }).structuredContent;
    const text = (
      r as { content: Array<{ type: string; text: string }> }
    ).content[0].text;
    expect(JSON.parse(text)).toEqual(sc);
  });
});
