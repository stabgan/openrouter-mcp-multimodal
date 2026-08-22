/** OpenRouter response caching via X-OpenRouter-Cache headers. */
export interface CacheOptions {
  cache?: boolean;
  cache_ttl?: string;
  cache_clear?: boolean;
}

/** Parse the env-default and return `true` when caching should be on by default. */
export function readCacheDefault(): boolean {
  const raw = (process.env.OPENROUTER_CACHE_RESPONSES ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Build X-OpenRouter-Cache headers for chat/analyze requests. */
export function buildCacheHeaders(opts: CacheOptions | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  const defaultOn = readCacheDefault();

  const enabled = opts?.cache ?? defaultOn;
  if (enabled) headers['X-OpenRouter-Cache'] = 'true';

  if (opts?.cache_ttl) headers['X-OpenRouter-Cache-TTL'] = opts.cache_ttl;
  if (opts?.cache_clear) headers['X-OpenRouter-Cache-Clear'] = 'true';

  return headers;
}

/** Extract cache metadata from response headers, null when not present. */
export interface CacheMeta {
  status: 'HIT' | 'MISS' | string;
  age?: number;
  ttl?: string;
}

export function extractCacheMeta(headers: Headers | undefined): CacheMeta | null {
  if (!headers) return null;
  const status = headers.get('x-openrouter-cache-status');
  if (!status) return null;
  const ageStr = headers.get('x-openrouter-cache-age');
  const ttl = headers.get('x-openrouter-cache-ttl') ?? undefined;
  const meta: CacheMeta = { status };
  if (ageStr) {
    const n = Number(ageStr);
    if (Number.isFinite(n)) meta.age = n;
  }
  if (ttl) meta.ttl = ttl;
  return meta;
}
