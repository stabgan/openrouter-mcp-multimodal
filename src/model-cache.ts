export interface OpenRouterModelRecord {
  id: string;
  name?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  context_length?: number;
  [key: string]: unknown;
}

export interface ModelSearchParams {
  query?: string;
  provider?: string;
  capabilities?: { vision?: boolean; audio?: boolean; video?: boolean };
  limit?: number;
  /** When true, return the full filtered set and ignore `limit`. Used by pagination. */
  all?: boolean;
}

function getCacheTtlMs(): number {
  const raw = process.env.OPENROUTER_MODEL_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return 3600000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3600000;
}

export const MAX_SEARCH_LIMIT = 50;

function buildMatcher(params: ModelSearchParams): (m: OpenRouterModelRecord) => boolean {
  const q = params.query?.toLowerCase();
  const providerPrefix = params.provider?.toLowerCase();
  const needVision = params.capabilities?.vision === true;
  const needAudio = params.capabilities?.audio === true;
  const needVideo = params.capabilities?.video === true;

  return (m: OpenRouterModelRecord): boolean => {
    if (q) {
      const id = m.id.toLowerCase();
      const name = m.name?.toLowerCase() ?? '';
      if (!id.includes(q) && !name.includes(q)) return false;
    }
    if (providerPrefix && !m.id.toLowerCase().startsWith(`${providerPrefix}/`)) {
      return false;
    }
    const mods = m.architecture?.input_modalities;
    if (needVision && !mods?.includes('image')) return false;
    if (needAudio && !mods?.includes('audio')) return false;
    if (needVideo && !mods?.includes('video')) return false;
    return true;
  };
}

export class ModelCache {
  private static instance: ModelCache;
  private models: Record<string, OpenRouterModelRecord> = {};
  private fetchedAt = 0;
  /**
   * Separate from `fetchedAt`: set whenever we successfully CALL the
   * fetcher (even if the response happens to be empty). Used by
   * `isValid()` so a successful-but-empty fetch still counts as "fresh"
   * and we don't hot-loop re-fetching the upstream.
   */
  private populatedAt = 0;
  private inflight: Promise<OpenRouterModelRecord[]> | null = null;

  static getInstance(): ModelCache {
    return (ModelCache.instance ??= new ModelCache());
  }

  isValid(): boolean {
    const fresh = Date.now() - this.populatedAt < getCacheTtlMs();
    return this.populatedAt > 0 && fresh;
  }

  setModels(models: OpenRouterModelRecord[]): void {
    this.models = Object.fromEntries(models.map((m) => [m.id, m]));
    this.fetchedAt = Date.now();
    this.populatedAt = this.fetchedAt;
  }

  /**
   * Force the cache back into an uninitialized state. Used by tests that
   * need to assert `ensureFresh()` actually calls the fetcher. Also useful
   * for ops (`health_check --reset`) if we ever expose such a knob.
   */
  reset(): void {
    this.models = {};
    this.fetchedAt = 0;
    this.populatedAt = 0;
    this.inflight = null;
  }

  /**
   * Populate the cache using `fetcher` if stale, coalescing concurrent callers
   * so only one request hits the upstream API per stale window. Callers that
   * arrive while a populate is in flight await the same promise.
   */
  async ensureFresh(fetcher: () => Promise<OpenRouterModelRecord[]>): Promise<void> {
    if (this.isValid()) return;
    if (this.inflight) {
      await this.inflight;
      return;
    }
    this.inflight = (async () => fetcher())();
    try {
      const models = await this.inflight;
      this.setModels(models);
    } finally {
      this.inflight = null;
    }
  }

  getAll(): OpenRouterModelRecord[] {
    return Object.values(this.models);
  }

  /** Number of models currently cached. Used by health_check. */
  size(): number {
    return Object.keys(this.models).length;
  }

  get(id: string): OpenRouterModelRecord | null {
    return this.models[id] ?? null;
  }

  has(id: string): boolean {
    return id in this.models;
  }

  /**
   * Single-pass paginated search: O(n) time, O(limit) extra space for the page.
   * Avoids materializing the full filtered array when only one page is needed.
   */
  searchPaginated(
    params: ModelSearchParams,
    offset: number,
    limit: number,
  ): { page: OpenRouterModelRecord[]; total: number } {
    const matches = buildMatcher(params);
    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.min(Math.max(1, limit), MAX_SEARCH_LIMIT);
    const page: OpenRouterModelRecord[] = [];
    let total = 0;
    let matchIndex = 0;

    for (const model of Object.values(this.models)) {
      if (!matches(model)) continue;
      if (matchIndex >= safeOffset && page.length < safeLimit) {
        page.push(model);
      }
      matchIndex++;
    }
    total = matchIndex;
    return { page, total };
  }

  search(params: ModelSearchParams): OpenRouterModelRecord[] {
    if (params.all) {
      const matches = buildMatcher(params);
      const results: OpenRouterModelRecord[] = [];
      for (const model of Object.values(this.models)) {
        if (matches(model)) results.push(model);
      }
      return results;
    }

    const limit = Math.min(Math.max(1, params.limit ?? 10), MAX_SEARCH_LIMIT);
    return this.searchPaginated(params, 0, limit).page;
  }
}
