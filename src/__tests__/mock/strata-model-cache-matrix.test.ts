import { describe, it, expect, beforeEach } from 'vitest';
import { ModelCache } from '../../model-cache.js';

const CATALOG = [
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    architecture: { input_modalities: ['text', 'image'] },
  },
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    architecture: { input_modalities: ['text', 'image'] },
  },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Gemma 4 26B',
    architecture: { input_modalities: ['text', 'image'] },
  },
  {
    id: 'meta/llama-3.2-3b-instruct:free',
    name: 'Llama 3.2 3B',
    architecture: { input_modalities: ['text'] },
  },
  {
    id: 'nvidia/nemotron-nano-12b-v2-vl:free',
    name: 'Nemotron VL',
    architecture: { input_modalities: ['text', 'image', 'video'] },
  },
  {
    id: 'qwen/qwen2-audio',
    name: 'Qwen Audio',
    architecture: { input_modalities: ['text', 'audio'] },
  },
];

describe('mock strata: model cache search matrix', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.reset();
    cache.setModels(CATALOG);
  });

  const queries = [
    'gpt',
    'claude',
    'gemma',
    'llama',
    'nemotron',
    'qwen',
    'free',
    'sonnet',
    'nano',
    '4o',
  ];
  it.each(queries)('query "%s" returns at least one match', (query) => {
    const { total } = cache.searchPaginated({ query }, 0, 10);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  const providers = ['openai', 'anthropic', 'google', 'meta', 'nvidia', 'qwen'];
  it.each(providers)('provider "%s" prefix filter is case-insensitive', (provider) => {
    const lower = cache.searchPaginated({ provider: provider.toLowerCase() }, 0, 10);
    const upper = cache.searchPaginated({ provider: provider.toUpperCase() }, 0, 10);
    expect(lower.total).toBe(upper.total);
  });

  const visionQueries = ['gpt', 'gemma', 'claude', 'nemotron'];
  it.each(visionQueries)('vision + query "%s" only returns image-capable models', (query) => {
    const { page } = cache.searchPaginated({ query, capabilities: { vision: true } }, 0, 10);
    expect(page.every((m) => m.architecture?.input_modalities?.includes('image'))).toBe(true);
  });

  it('audio capability filter returns qwen audio model', () => {
    const audioOnly = cache.searchPaginated({ capabilities: { audio: true } }, 0, 10);
    expect(audioOnly.total).toBe(1);
    expect(audioOnly.page[0].id).toContain('qwen');
  });

  it('video capability filter returns nemotron', () => {
    const videoOnly = cache.searchPaginated({ capabilities: { video: true } }, 0, 10);
    expect(videoOnly.total).toBe(1);
    expect(videoOnly.page[0].id).toContain('nemotron');
  });

  const offsets = [0, 1, 2, 3, 5, 10, 100];
  it.each(offsets)('pagination offset %i is stable with total', (offset) => {
    const { page, total } = cache.searchPaginated({}, offset, 2);
    expect(page.length).toBeLessThanOrEqual(2);
    expect(total).toBe(CATALOG.length);
    if (offset >= total) expect(page).toHaveLength(0);
  });

  const limits = [1, 2, 3, 5, 50, 999];
  it.each(limits)('limit %i is clamped to catalog size or max 50', (limit) => {
    const { page } = cache.searchPaginated({}, 0, limit);
    expect(page.length).toBeLessThanOrEqual(Math.min(limit, 50, CATALOG.length));
  });

  const combined = [
    { query: 'free', cap: { vision: true } as const },
    { query: 'free', cap: { vision: false } as const },
    { provider: 'google', cap: { vision: true } as const },
    { provider: 'meta', cap: undefined },
  ];
  it.each(combined)('combined filter %# returns consistent totals', (f) => {
    const a = cache.searchPaginated(
      { query: f.query, provider: f.provider, capabilities: f.cap },
      0,
      10,
    );
    const b = cache.searchPaginated(
      { query: f.query, provider: f.provider, capabilities: f.cap, all: true },
      0,
      10,
    );
    expect(a.total).toBe(b.total);
  });
});

describe('mock strata: model cache free-model discovery', () => {
  beforeEach(() => {
    ModelCache.getInstance().reset();
  });

  const freeSlugs = [
    'google/gemma-4-26b-a4b-it:free',
    'google/gemma-4-31b-it:free',
    'meta/llama/llama-3.2-3b-instruct:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'nvidia/nemotron-nano-12b-v2-vl:free',
    'poolside/laguna-xs.2:free',
  ];

  it.each(freeSlugs)('catalog containing %s is findable via :free query', (id) => {
    const cache = ModelCache.getInstance();
    cache.setModels([{ id, name: id }]);
    const { total } = cache.searchPaginated({ query: 'free' }, 0, 10);
    expect(total).toBeGreaterThanOrEqual(1);
  });
});
