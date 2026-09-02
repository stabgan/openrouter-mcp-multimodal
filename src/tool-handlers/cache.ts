/** OpenRouter response caching via X-OpenRouter-Cache headers. */
import { ErrorCode, toolError, type ToolErrorResult } from '../errors.js';

export interface CacheOptions {
  cache?: boolean;
  cache_ttl?: string;
  cache_clear?: boolean;
}

const MIN_CACHE_TTL_SECONDS = 1;
const MAX_CACHE_TTL_SECONDS = 86_400;
const INTEGER_TTL_RE = /^\d+$/;
const DURATION_TTL_RE = /^(\d+)([smh])$/i;

const CACHE_TTL_INVALID_MSG =
  `cache_ttl must be an integer seconds value (${MIN_CACHE_TTL_SECONDS}–${MAX_CACHE_TTL_SECONDS}) ` +
  'or a duration string like "30s", "5m", or "1h".';

export function readCacheDefault(): boolean {
  const raw = (process.env.OPENROUTER_CACHE_RESPONSES ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function resolveCacheTtl(cacheTtl: string): string | ToolErrorResult {
  const trimmed = cacheTtl.trim();
  if (!trimmed) {
    return toolError(ErrorCode.INVALID_INPUT, CACHE_TTL_INVALID_MSG);
  }

  let seconds: number;
  const durationMatch = DURATION_TTL_RE.exec(trimmed);
  if (durationMatch) {
    const value = Number.parseInt(durationMatch[1]!, 10);
    const unit = durationMatch[2]!.toLowerCase() as 's' | 'm' | 'h';
    switch (unit) {
      case 's':
        seconds = value;
        break;
      case 'm':
        seconds = value * 60;
        break;
      case 'h':
        seconds = value * 3600;
        break;
      default: {
        const _exhaustive: never = unit;
        return toolError(ErrorCode.INVALID_INPUT, CACHE_TTL_INVALID_MSG);
      }
    }
  } else if (INTEGER_TTL_RE.test(trimmed)) {
    seconds = Number.parseInt(trimmed, 10);
  } else {
    return toolError(ErrorCode.INVALID_INPUT, CACHE_TTL_INVALID_MSG);
  }

  if (seconds < MIN_CACHE_TTL_SECONDS || seconds > MAX_CACHE_TTL_SECONDS) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `cache_ttl must be between ${MIN_CACHE_TTL_SECONDS} and ${MAX_CACHE_TTL_SECONDS} seconds (inclusive).`,
    );
  }
  return String(seconds);
}

export function validateCacheOptions(opts: CacheOptions | undefined): ToolErrorResult | null {
  if (!opts?.cache_ttl) return null;
  const resolved = resolveCacheTtl(opts.cache_ttl);
  return typeof resolved === 'string' ? null : resolved;
}

export function buildCacheHeaders(opts: CacheOptions | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  const defaultOn = readCacheDefault();
  const enabled = opts?.cache ?? defaultOn;
  if (enabled) headers['X-OpenRouter-Cache'] = 'true';
  if (opts?.cache_ttl) {
    const resolved = resolveCacheTtl(opts.cache_ttl);
    if (typeof resolved === 'string') headers['X-OpenRouter-Cache-TTL'] = resolved;
  }
  if (opts?.cache_clear) headers['X-OpenRouter-Cache-Clear'] = 'true';
  return headers;
}

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
