import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ModelCache } from '../model-cache.js';

describe('ModelCache', () => {
  let cache: ModelCache;

  beforeEach(() => {
    vi.unstubAllEnvs();
    cache = ModelCache.getInstance();
    cache.setModels([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const sampleModels = [
    {
      id: 'openai/gpt-4',
      name: 'OpenAI: GPT-4',
      architecture: { input_modalities: ['text', 'image'] },
      context_length: 128000,
    },
    {
      id: 'anthropic/claude-3',
      name: 'Anthropic: Claude 3',
      architecture: { input_modalities: ['text', 'image'] },
      context_length: 200000,
    },
    {
      id: 'meta/llama-3',
      name: 'Meta: Llama 3',
      architecture: { input_modalities: ['text'] },
      context_length: 8192,
    },
    {
      id: 'qwen/qwen-vl:free',
      name: 'Qwen: VL (free)',
      architecture: { input_modalities: ['text', 'image'] },
      context_length: 32000,
    },
  ];

  it('should be a singleton', () => {
    const a = ModelCache.getInstance();
    const b = ModelCache.getInstance();
    expect(a).toBe(b);
  });

  it('should store and retrieve models', () => {
    cache.setModels(sampleModels);
    expect(cache.getAll()).toHaveLength(4);
    expect(cache.get('openai/gpt-4')).toEqual(sampleModels[0]);
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('should check model existence', () => {
    cache.setModels(sampleModels);
    expect(cache.has('openai/gpt-4')).toBe(true);
    expect(cache.has('nonexistent')).toBe(false);
  });

  it('should report valid cache after setModels', () => {
    expect(cache.isValid()).toBe(false);
    cache.setModels(sampleModels);
    expect(cache.isValid()).toBe(true);
  });

  it('should search by query', () => {
    cache.setModels(sampleModels);
    const results = cache.search({ query: 'gpt' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('openai/gpt-4');
  });

  it('should search by provider', () => {
    cache.setModels(sampleModels);
    const results = cache.search({ provider: 'anthropic' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('anthropic/claude-3');
  });

  it('should filter by vision capability', () => {
    cache.setModels(sampleModels);
    const results = cache.search({ capabilities: { vision: true } });
    expect(results).toHaveLength(3);
    expect(results.every((m) => m.architecture?.input_modalities?.includes('image'))).toBe(true);
  });

  it('should respect limit', () => {
    cache.setModels(sampleModels);
    const results = cache.search({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('should combine filters', () => {
    cache.setModels(sampleModels);
    const results = cache.search({ query: 'free', capabilities: { vision: true } });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('qwen/qwen-vl:free');
  });

  it('should expire cache after TTL from env', async () => {
    vi.stubEnv('OPENROUTER_MODEL_CACHE_TTL_MS', '25');
    cache.setModels(sampleModels);
    expect(cache.isValid()).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(cache.isValid()).toBe(false);
  });
});
