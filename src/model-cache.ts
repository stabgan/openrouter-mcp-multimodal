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

/** OpenRouter routing suffixes appended at request time — not part of catalog ids (usually). */
export const ROUTING_SUFFIXES = [':nitro', ':floor', ':free', ':online', ':exacto'] as const;

export type RoutingSuffix = (typeof ROUTING_SUFFIXES)[number];

/** Strip a trailing routing suffix from a model slug for catalog lookup. */
export function stripRoutingSuffix(modelId: string): string {
  for (const suffix of ROUTING_SUFFIXES) {
    if (modelId.endsWith(suffix)) return modelId.slice(0, -suffix.length);
  }
  return modelId;
}

export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

export function clampLimit(limit: number, fallback = 10): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_SEARCH_LIMIT);
}

function sortedModels(models: Record<string, OpenRouterModelRecord>): OpenRouterModelRecord[] {
  return Object.values(models).sort((a, b) => a.id.localeCompare(b.id));
}

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

  /** Reset cache state (tests). */
  reset(): void {
    this.models = {};
    this.fetchedAt = 0;
    this.populatedAt = 0;
    this.inflight = null;
  }

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
   * Resolve a user-supplied model id against the catalog: exact match, strip
   * routing suffixes (`:nitro`, `:free`, …), then case-insensitive id match.
   */
  lookup(id: string): OpenRouterModelRecord | null {
    if (!id) return null;
    const exact = this.models[id];
    if (exact) return exact;

    const stripped = stripRoutingSuffix(id);
    if (stripped !== id) {
      const base = this.models[stripped];
      if (base) return base;
    }

    const lower = id.toLowerCase();
    for (const model of Object.values(this.models)) {
      if (model.id.toLowerCase() === lower) return model;
    }
    if (stripped !== id) {
      const lowerStripped = stripped.toLowerCase();
      for (const model of Object.values(this.models)) {
        if (model.id.toLowerCase() === lowerStripped) return model;
      }
    }
    return null;
  }

  catalogHas(id: string): boolean {
    return this.lookup(id) !== null;
  }

  searchPaginated(
    params: ModelSearchParams,
    offset: number,
    limit: number,
  ): { page: OpenRouterModelRecord[]; total: number } {
    const matches = buildMatcher(params);
    const safeOffset = clampOffset(offset);
    const safeLimit = clampLimit(limit);
    const page: OpenRouterModelRecord[] = [];
    let matchIndex = 0;

    for (const model of sortedModels(this.models)) {
      if (!matches(model)) continue;
      if (matchIndex >= safeOffset && page.length < safeLimit) {
        page.push(model);
      }
      matchIndex++;
    }
    return { page, total: matchIndex };
  }

  search(params: ModelSearchParams): OpenRouterModelRecord[] {
    if (params.all) {
      const matches = buildMatcher(params);
      const results: OpenRouterModelRecord[] = [];
      for (const model of sortedModels(this.models)) {
        if (matches(model)) results.push(model);
      }
      return results;
    }

    const limit = clampLimit(params.limit ?? 10);
    return this.searchPaginated(params, 0, limit).page;
  }
}
