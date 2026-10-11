export interface OpenRouterModelRecord {
  id: string;
  name?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  context_length?: number;
  [key: string]: unknown;
}

/**
 * Keys that could cause prototype pollution when iterated with
 * Object.entries/for-in, Object.assign, or lodash deep-merge.
 *
 * Model catalog records arrive from the upstream OpenRouter API with an open
 * index signature (`[key: string]: unknown`).  Every other handler in the
 * codebase sanitizes upstream data before forwarding to MCP clients (embed_text
 * strips unsafe keys from embeddings, decide from answers, rerank from results,
 * and logger from log context).  Model records were the remaining gap — they
 * flowed through `buildStructuredResult` unsanitized.
 *
 * While JSON.parse in V8 creates `__proto__` as a regular own property (not
 * actual prototype mutation), MCP clients that process `structuredContent`
 * with unsafe patterns (lodash deep-merge, Object.assign spread, for-in
 * iteration) could be exploited by a compromised upstream response that
 * includes these keys.  Defence-in-depth: strip them at the output boundary.
 */
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Maximum recursion depth for model-record sanitization.  Model records
 * have known nested shapes (`architecture`, `pricing`, `top_provider`)
 * that are typically 2–3 levels deep.  The upstream response is untrusted
 * and could contain pathologically deep nesting — cap at 8 to cover any
 * real record shape while preventing stack overflow.  Matches the
 * defence-in-depth depth-capping pattern used by `hasDeepUnsafeKey` (32)
 * in the `decide` handler and `sanitizeCtx` (32) in the logger.
 */
const MAX_SANITIZE_DEPTH = 8;

/**
 * Recursively scan a value for prototype-pollution keys.  Returns `true`
 * if any object in the tree (up to `MAX_SANITIZE_DEPTH`) contains a key
 * in `UNSAFE_RECORD_KEYS`.  Used as the fast-path gate: when no unsafe
 * keys exist anywhere in the record, `sanitizeModelRecordForOutput`
 * returns the original reference without copying.
 */
function hasDeepUnsafeRecordKey(value: unknown, depth: number): boolean {
  if (depth <= 0) return false;
  if (value === null || value === undefined || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (hasDeepUnsafeRecordKey(item, depth - 1)) return true;
    }
    return false;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (UNSAFE_RECORD_KEYS.has(key)) return true;
    if (hasDeepUnsafeRecordKey(obj[key], depth - 1)) return true;
  }
  return false;
}

/**
 * Recursively strip prototype-pollution keys from a value.  Objects are
 * shallow-copied with unsafe keys removed; arrays have their elements
 * sanitized; primitives pass through unchanged.  Depth is capped to
 * prevent stack overflow from pathologically deep upstream responses —
 * values beyond the limit are replaced with `null`.
 *
 * Only called after `hasDeepUnsafeRecordKey` confirms the tree contains
 * at least one unsafe key, so the copy is never wasted.
 */
function stripUnsafeKeys(value: unknown, depth: number): unknown {
  if (depth <= 0) return null;
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUnsafeKeys(item, depth - 1));
  }
  const obj = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(obj)) {
    if (UNSAFE_RECORD_KEYS.has(key)) continue;
    safe[key] = stripUnsafeKeys(v, depth - 1);
  }
  return safe;
}

/**
 * Strip prototype-pollution keys from a model record before forwarding to
 * MCP clients via `buildStructuredResult`.  Called by `get_model_info` and
 * `search_models` at the output boundary — internal cache consumers
 * (matching, lookup) operate on the original records.
 *
 * Recursively sanitizes nested objects (`architecture`, `pricing`,
 * `top_provider`, and any other nested structures from the open index
 * signature).  The upstream model catalog is fetched over HTTP and is
 * untrusted — a compromised upstream could inject `__proto__` keys at
 * any nesting level.  The previous shallow-only sanitization stripped
 * unsafe keys at the top level but left nested objects unsanitized,
 * allowing prototype-pollution keys to flow into `structuredContent`
 * for MCP clients that process it with unsafe patterns (lodash
 * deep-merge, Object.assign spread, for-in iteration).
 *
 * Fast path: when no unsafe keys exist anywhere in the record tree,
 * returns the original reference without copying.
 */
export function sanitizeModelRecordForOutput(record: OpenRouterModelRecord): OpenRouterModelRecord {
  if (!hasDeepUnsafeRecordKey(record, MAX_SANITIZE_DEPTH)) return record;
  return stripUnsafeKeys(record, MAX_SANITIZE_DEPTH) as OpenRouterModelRecord;
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

/** Strip a trailing routing suffix from a model slug for catalog lookup.
 *  Comparison is case-insensitive so `:FREE`, `:Nitro`, etc. are stripped. */
export function stripRoutingSuffix(modelId: string): string {
  const lower = modelId.toLowerCase();
  for (const suffix of ROUTING_SUFFIXES) {
    if (lower.endsWith(suffix)) return modelId.slice(0, -suffix.length);
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

function buildMatcher(params: ModelSearchParams): (m: OpenRouterModelRecord) => boolean {
  // Trim whitespace so `query: "  openai/gpt-4o  "` matches correctly.
  const rawQuery = params.query?.trim().toLowerCase() || undefined;
  // Strip routing suffixes so `search_models(query: "openai/gpt-4o:nitro")` finds
  // `openai/gpt-4o` — catalog IDs never contain routing suffixes. Match either the
  // original query or the stripped form to stay backward-compatible.
  const strippedQuery = rawQuery ? stripRoutingSuffix(rawQuery).toLowerCase() : undefined;
  const queries: string[] =
    rawQuery && strippedQuery && strippedQuery !== rawQuery
      ? [rawQuery, strippedQuery]
      : rawQuery
        ? [rawQuery]
        : [];
  // Trim whitespace and strip trailing slashes so `provider: "openai/"` doesn't
  // construct a `"openai//"` prefix check that never matches model IDs.
  const providerPrefix = params.provider?.trim().toLowerCase().replace(/\/+$/, '') || undefined;
  const needVision = params.capabilities?.vision === true;
  const needAudio = params.capabilities?.audio === true;
  const needVideo = params.capabilities?.video === true;

  return (m: OpenRouterModelRecord): boolean => {
    if (queries.length > 0) {
      const id = m.id.toLowerCase();
      const name = m.name?.toLowerCase() ?? '';
      if (!queries.some((term) => id.includes(term) || name.includes(term))) return false;
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
  /** Lazily-computed sorted snapshot; invalidated on setModels/reset. */
  private sortedCache: OpenRouterModelRecord[] | null = null;
  /** Lowercase model-id → model record for O(1) case-insensitive lookups. */
  private lowerIdIndex: Map<string, OpenRouterModelRecord> = new Map();

  static getInstance(): ModelCache {
    return (ModelCache.instance ??= new ModelCache());
  }

  isValid(): boolean {
    const fresh = Date.now() - this.populatedAt < getCacheTtlMs();
    return this.populatedAt > 0 && fresh;
  }

  setModels(models: OpenRouterModelRecord[]): void {
    this.models = Object.fromEntries(models.map((m) => [m.id, m]));
    this.sortedCache = null;
    // Rebuild O(1) case-insensitive index (keyed by lowercase id).
    const idx = new Map<string, OpenRouterModelRecord>();
    for (const m of models) {
      idx.set(m.id.toLowerCase(), m);
    }
    this.lowerIdIndex = idx;
    this.fetchedAt = Date.now();
    this.populatedAt = this.fetchedAt;
  }

  /** Reset cache state (tests). */
  reset(): void {
    this.models = {};
    this.sortedCache = null;
    this.lowerIdIndex = new Map();
    this.fetchedAt = 0;
    this.populatedAt = 0;
    this.inflight = null;
  }

  /**
   * Return models sorted by id. The sorted array is computed once after each
   * setModels/reset and reused until the next mutation — avoids O(n log n)
   * re-sorting on every search call.
   */
  private getSortedModels(): OpenRouterModelRecord[] {
    if (!this.sortedCache) {
      this.sortedCache = Object.values(this.models).sort((a, b) => a.id.localeCompare(b.id));
    }
    return this.sortedCache;
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
      if (models.length === 0 && Object.keys(this.models).length > 0) {
        // Upstream returned an empty model list but we have stale data.
        // Preserve the existing models rather than replacing them with
        // nothing — stale data is far more useful than no data. Refresh
        // the TTL so we don't hot-loop retries on every tool call.
        this.populatedAt = Date.now();
        return;
      }
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

    // O(1) case-insensitive lookup via pre-built lowercase index.
    const lower = id.toLowerCase();
    const byLower = this.lowerIdIndex.get(lower);
    if (byLower) return byLower;
    if (stripped !== id) {
      const lowerStripped = stripped.toLowerCase();
      const byLowerStripped = this.lowerIdIndex.get(lowerStripped);
      if (byLowerStripped) return byLowerStripped;
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

    for (const model of this.getSortedModels()) {
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
      for (const model of this.getSortedModels()) {
        if (matches(model)) results.push(model);
      }
      return results;
    }

    const limit = clampLimit(params.limit ?? 10);
    return this.searchPaginated(params, 0, limit).page;
  }
}
