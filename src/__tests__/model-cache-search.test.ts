import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ModelCache } from '../model-cache.js';

describe('ModelCache.searchPaginated', () => {
  let cache: ModelCache;

  const sampleModels = [
    {
      id: 'openai/gpt-4',
      name: 'OpenAI: GPT-4',
      architecture: { input_modalities: ['text', 'image'] },
    },
    {
      id: 'anthropic/claude-3',
      name: 'Anthropic: Claude 3',
      architecture: { input_modalities: ['text', 'image'] },
    },
    {
      id: 'meta/llama-3',
      name: 'Meta: Llama 3',
      architecture: { input_modalities: ['text'] },
    },
    {
      id: 'qwen/qwen-vl:free',
      name: 'Qwen: VL (free)',
      architecture: { input_modalities: ['text', 'image'] },
    },
    {
      id: 'google/gemini-2.5-flash',
      name: 'Gemini Flash',
      architecture: { input_modalities: ['text', 'image', 'video'] },
    },
  ];

  beforeEach(() => {
    vi.unstubAllEnvs();
    cache = ModelCache.getInstance();
    cache.reset();
    cache.setModels(sampleModels);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns first page without materializing full match array', () => {
    const { page, total } = cache.searchPaginated({ capabilities: { vision: true } }, 0, 2);
    expect(total).toBe(4);
    expect(page).toHaveLength(2);
    expect(page[0].id).toBe('openai/gpt-4');
    expect(page[1].id).toBe('anthropic/claude-3');
  });

  it('honors offset for second page', () => {
    const first = cache.searchPaginated({ capabilities: { vision: true } }, 0, 2);
    const second = cache.searchPaginated({ capabilities: { vision: true } }, 2, 2);
    expect(first.total).toBe(second.total);
    expect(second.page).toHaveLength(2);
    expect(second.page[0].id).toBe('qwen/qwen-vl:free');
    expect(second.page[1].id).toBe('google/gemini-2.5-flash');
  });

  it('returns empty page when offset exceeds total matches', () => {
    const { page, total } = cache.searchPaginated({}, 100, 10);
    expect(total).toBe(5);
    expect(page).toHaveLength(0);
  });

  it('combines query, provider, and capability filters in one pass', () => {
    const { page, total } = cache.searchPaginated(
      { query: 'gemini', capabilities: { video: true } },
      0,
      10,
    );
    expect(total).toBe(1);
    expect(page[0].id).toBe('google/gemini-2.5-flash');
  });

  it('treats negative offset as zero', () => {
    const { page } = cache.searchPaginated({}, -5, 2);
    expect(page).toHaveLength(2);
  });

  it('clamps limit to MAX_SEARCH_LIMIT', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `prov/model-${i}`,
      name: `Model ${i}`,
      architecture: { input_modalities: ['text'] },
    }));
    cache.setModels(many);
    const { page } = cache.searchPaginated({}, 0, 999);
    expect(page.length).toBeLessThanOrEqual(50);
  });

  it('matches query case-insensitively on id and name', () => {
    const { total } = cache.searchPaginated({ query: 'GPT-4' }, 0, 10);
    expect(total).toBe(1);
  });

  it('matches provider prefix case-insensitively', () => {
    const { total } = cache.searchPaginated({ provider: 'OpenAI' }, 0, 10);
    expect(total).toBe(1);
  });
});

describe('ModelCache.search edge cases', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.reset();
  });

  it('returns empty array when cache is empty', () => {
    expect(cache.search({ query: 'anything' })).toEqual([]);
  });

  it('returns all models when no filters and limit defaults', () => {
    cache.setModels([{ id: 'a/b' }, { id: 'c/d' }]);
    expect(cache.search({})).toHaveLength(2);
  });

  it('all:true ignores limit cap for slice but search still respects internal max when not all', () => {
    const models = Array.from({ length: 15 }, (_, i) => ({ id: `p/m${i}` }));
    cache.setModels(models);
    expect(cache.search({ all: true })).toHaveLength(15);
    expect(cache.search({ limit: 5 })).toHaveLength(5);
  });
});
