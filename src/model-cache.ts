export interface OpenRouterModelRecord {
  id: string;
  name?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  context_length?: number;
  [key: string]: unknown;
}

function getCacheTtlMs(): number {
  const raw = process.env.OPENROUTER_MODEL_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return 3600000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3600000;
}

const MAX_SEARCH_LIMIT = 50;

export class ModelCache {
  private static instance: ModelCache;
  private models: Record<string, OpenRouterModelRecord> = {};
  private fetchedAt = 0;
  private inflight: Promise<OpenRouterModelRecord[]> | null = null;

  static getInstance(): ModelCache {
    return (ModelCache.instance ??= new ModelCache());
  }

  isValid(): boolean {
    return Object.keys(this.models).length > 0 && Date.now() - this.fetchedAt < getCacheTtlMs();
  }

  setModels(models: OpenRouterModelRecord[]): void {
    this.models = Object.fromEntries(models.map((m) => [m.id, m]));
    this.fetchedAt = Date.now();
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

  search(params: {
    query?: string;
    provider?: string;
    capabilities?: { vision?: boolean; audio?: boolean; video?: boolean };
    limit?: number;
    /** When true, return the full filtered set and ignore `limit`. Used by pagination. */
    all?: boolean;
  }): OpenRouterModelRecord[] {
    let results = this.getAll();

    if (params.query) {
      const q = params.query.toLowerCase();
      results = results.filter(
        (m) => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q),
      );
    }
    if (params.provider) {
      const p = params.provider.toLowerCase();
      results = results.filter((m) => m.id.toLowerCase().startsWith(p + '/'));
    }
    if (params.capabilities?.vision) {
      results = results.filter((m) => m.architecture?.input_modalities?.includes('image'));
    }
    if (params.capabilities?.audio) {
      results = results.filter((m) => m.architecture?.input_modalities?.includes('audio'));
    }
    if (params.capabilities?.video) {
      results = results.filter((m) => m.architecture?.input_modalities?.includes('video'));
    }

    if (params.all) return results;

    const limit = Math.min(Math.max(1, params.limit ?? 10), MAX_SEARCH_LIMIT);
    return results.slice(0, limit);
  }
}
