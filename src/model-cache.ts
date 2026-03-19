export interface OpenRouterModelRecord {
  id: string;
  name?: string;
  architecture?: { input_modalities?: string[] };
  context_length?: number;
  [key: string]: unknown;
}

function getCacheTtlMs(): number {
  const raw = process.env.OPENROUTER_MODEL_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return 3600000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3600000;
}

export class ModelCache {
  private static instance: ModelCache;
  private models: Record<string, OpenRouterModelRecord> = {};
  private fetchedAt = 0;

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

  getAll(): OpenRouterModelRecord[] {
    return Object.values(this.models);
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
    capabilities?: { vision?: boolean };
    limit?: number;
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

    return results.slice(0, params.limit ?? 10);
  }
}
