import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { ModelCache } from '../model-cache.js';
import { handleSearchModels } from '../tool-handlers/search-models.js';
import { handleGetModelInfo } from '../tool-handlers/get-model-info.js';
import { handleValidateModel } from '../tool-handlers/validate-model.js';

const models = [
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    architecture: { input_modalities: ['text', 'image'] },
  },
  {
    id: 'audio/test',
    name: 'Audio Test',
    architecture: { input_modalities: ['audio'] },
  },
];

describe('model tool handlers', () => {
  const cache = ModelCache.getInstance();

  beforeEach(() => {
    cache.setModels([]);
  });

  it('search_models filters and limits results', async () => {
    cache.setModels(models);
    const apiClient = { getModels: vi.fn() } as unknown as OpenRouterAPIClient;
    const result = await handleSearchModels(
      { params: { arguments: { query: 'gpt', limit: 1 } } },
      apiClient,
      cache,
    );
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('openai/gpt-4o');
  });

  it('search_models surfaces upstream failures', async () => {
    cache.setModels([]);
    const apiClient = {
      getModels: vi.fn().mockRejectedValue(new Error('POST /models failed: HTTP 402 — no credits')),
    } as unknown as OpenRouterAPIClient;
    const result = await handleSearchModels(
      { params: { arguments: { query: 'gpt' } } },
      apiClient,
      cache,
    );
    expect(result.isError).toBe(true);
    expect((result as { _meta: { code: string } })._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('get_model_info returns the matching model', async () => {
    cache.setModels(models);
    const result = await handleGetModelInfo(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    expect(result.isError).toBeFalsy();
    const info = JSON.parse(result.content[0].text);
    expect(info.id).toBe('openai/gpt-4o');
  });

  it('get_model_info rejects missing model ids', async () => {
    cache.setModels(models);
    const result = await handleGetModelInfo({ params: { arguments: { model: '' } } }, cache);
    expect(result.isError).toBe(true);
    expect((result as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('get_model_info returns MODEL_NOT_FOUND when absent', async () => {
    cache.setModels(models);
    const result = await handleGetModelInfo(
      { params: { arguments: { model: 'missing/model' } } },
      cache,
    );
    expect(result.isError).toBe(true);
    expect((result as { _meta: { code: string } })._meta.code).toBe('MODEL_NOT_FOUND');
  });

  it('get_model_info returns INTERNAL when cache is empty and no client', async () => {
    cache.setModels([]);
    const result = await handleGetModelInfo(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    expect(result.isError).toBe(true);
    expect((result as { _meta: { code: string } })._meta.code).toBe('INTERNAL');
  });

  it('validate_model reports validity', async () => {
    cache.setModels(models);
    const result = await handleValidateModel(
      { params: { arguments: { model: 'audio/test' } } },
      cache,
    );
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual({ valid: true });
  });

  it('validate_model rejects empty model ids', async () => {
    cache.setModels(models);
    const result = await handleValidateModel({ params: { arguments: { model: '' } } }, cache);
    expect(result.isError).toBe(true);
    expect((result as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });
});
