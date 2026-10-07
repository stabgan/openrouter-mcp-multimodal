import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelCache } from '../model-cache.js';

describe('ModelCache.ensureFresh coalescing', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    // Reset the singleton entirely — `setModels([])` now marks the cache
    // as populated (v4.5.0 changed this to avoid hot-looping on a
    // successful-but-empty upstream response). Tests that want to assert
    // `ensureFresh()` calls the fetcher need an explicit reset.
    cache.reset();
  });

  it('coalesces concurrent populates into a single fetcher call', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 25));
      return [{ id: 'a/b', name: 'Model A/B' }];
    };

    await Promise.all([
      cache.ensureFresh(fetcher),
      cache.ensureFresh(fetcher),
      cache.ensureFresh(fetcher),
      cache.ensureFresh(fetcher),
    ]);

    expect(calls).toBe(1);
    expect(cache.has('a/b')).toBe(true);
  });

  it('clears the in-flight slot after success so subsequent stale windows refetch', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return [{ id: 'x/y' }];
    };

    await cache.ensureFresh(fetcher);
    // Manually invalidate so the next call has to re-fetch.
    cache.reset();
    await cache.ensureFresh(fetcher);
    expect(calls).toBe(2);
  });

  it('releases the in-flight slot on fetcher failure', async () => {
    let calls = 0;
    const fail = async () => {
      calls += 1;
      throw new Error('nope');
    };

    await expect(cache.ensureFresh(fail)).rejects.toThrow('nope');
    await expect(cache.ensureFresh(fail)).rejects.toThrow('nope');
    expect(calls).toBe(2);
  });

  it('preserves stale data when upstream returns empty model list', async () => {
    // Populate with real data first.
    cache.setModels([{ id: 'openai/gpt-4o', name: 'GPT-4o' }]);
    expect(cache.size()).toBe(1);
    expect(cache.has('openai/gpt-4o')).toBe(true);

    // Invalidate so ensureFresh will refetch.
    const orig = cache.isValid;
    let validCalls = 0;
    vi.spyOn(cache, 'isValid').mockImplementation(() => {
      validCalls += 1;
      // First call (from ensureFresh entry): stale. Subsequent: let through normally.
      if (validCalls === 1) return false;
      return orig.call(cache);
    });

    // Fetcher returns empty — simulates partial upstream outage.
    const emptyFetcher = vi.fn(async () => []);
    await cache.ensureFresh(emptyFetcher);

    // Stale data must survive — the empty response should NOT replace it.
    expect(cache.size()).toBe(1);
    expect(cache.has('openai/gpt-4o')).toBe(true);
    expect(emptyFetcher).toHaveBeenCalledOnce();
  });

  it('accepts empty list on first boot (no stale data to preserve)', async () => {
    // Cache starts completely empty.
    expect(cache.size()).toBe(0);

    const emptyFetcher = vi.fn(async () => []);
    await cache.ensureFresh(emptyFetcher);

    // No stale data → accept the empty list (prevents hot-loop on first boot).
    expect(cache.size()).toBe(0);
    expect(cache.isValid()).toBe(true);
    expect(emptyFetcher).toHaveBeenCalledOnce();
  });
});
