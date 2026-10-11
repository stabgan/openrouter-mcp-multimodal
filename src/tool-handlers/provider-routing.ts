/**
 * OpenRouter provider routing — merges tool args over OPENROUTER_PROVIDER_* env defaults.
 */
import { ErrorCode, toolError, type ToolErrorResult } from '../errors.js';
import { logger } from '../logger.js';

export type ProviderSort = 'price' | 'throughput' | 'latency';
export type DataCollectionPolicy = 'allow' | 'deny';

export interface ProviderRoutingOptions {
  /** Filter providers by quantization (e.g. `['fp16', 'int8']`). */
  quantizations?: string[];
  /** Exclude these provider slugs (e.g. `['openai', 'anthropic']`). */
  ignore?: string[];
  /** Allow only these provider slugs for the request. */
  only?: string[];
  /** Sort providers by this criterion. */
  sort?: ProviderSort;
  /** Prioritized provider list (e.g. `['openai/gpt-4o', 'anthropic/claude-3-opus']`). */
  order?: string[];
  /** Only use providers that support every parameter in the request. */
  require_parameters?: boolean;
  /** Whether providers may collect request data. */
  data_collection?: DataCollectionPolicy;
  /** Allow fallback to unlisted providers when preferred ones fail. */
  allow_fallbacks?: boolean;
}

/**
 * Maximum serialized size for the provider routing object (bytes).
 *
 * Every other user-controlled complex object that flows into outbound API
 * request bodies has a size ceiling:
 *   - `MAX_STATE_BYTES` (100 KB) in the `decide` handler
 *   - `MAX_RESPONSE_FORMAT_BYTES` (100 KB) in `chat-request`
 *   - `MAX_TOTAL_INPUT_CHARS` (10 MB) in `embed_text` / `rerank`
 *
 * The `provider` parameter was the remaining uncapped one.  Without a limit
 * a malicious MCP client can send multi-megabyte arrays in `order`, `ignore`,
 * or `only`, causing memory exhaustion during `JSON.stringify` of the
 * outbound request body.  100 KB is generous for any real routing config.
 */
const MAX_PROVIDER_BODY_BYTES = 100_000;

/**
 * Maximum number of entries in each provider routing array (`order`, `ignore`,
 * `only`, `quantizations`).  Individual elements are unbounded strings, so
 * a cap on count prevents attacker-controlled arrays from being arbitrarily
 * long even within the overall byte ceiling.
 */
const MAX_PROVIDER_ARRAY_ENTRIES = 200;

/** Keys that could cause prototype pollution when iterated with Object.entries/for-in. */
const UNSAFE_PROVIDER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate user-supplied provider routing options before merging with env
 * defaults.  Returns a `ToolErrorResult` on violation, or `null` when valid.
 *
 * Catches:
 *   - non-object values (string, array, number, null)
 *   - prototype-pollution keys
 *   - oversized arrays in known routing fields
 *   - total serialized size exceeding `MAX_PROVIDER_BODY_BYTES`
 *
 * Call this in every handler that accepts a `provider` parameter, before
 * `mergeProviderOptions` / `buildProviderBody`.
 */
export function validateProviderOptions(provider: unknown): ToolErrorResult | null {
  if (provider === undefined || provider === null) return null;

  if (typeof provider !== 'object' || Array.isArray(provider)) {
    return toolError(ErrorCode.INVALID_INPUT, 'provider must be a plain object.');
  }

  const obj = provider as Record<string, unknown>;

  // Block prototype-pollution keys.
  for (const key of Object.keys(obj)) {
    if (UNSAFE_PROVIDER_KEYS.has(key)) {
      return toolError(ErrorCode.INVALID_INPUT, `provider contains unsafe key "${key}".`);
    }
  }

  // Cap array lengths for known routing fields.
  const arrayFields = ['order', 'ignore', 'only', 'quantizations'] as const;
  for (const field of arrayFields) {
    const val = obj[field];
    if (Array.isArray(val) && val.length > MAX_PROVIDER_ARRAY_ENTRIES) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `provider.${field} has ${val.length} entries — max ${MAX_PROVIDER_ARRAY_ENTRIES}.`,
      );
    }
  }

  // Cap total serialized size.
  let serializedSize: number;
  try {
    serializedSize = JSON.stringify(obj).length;
  } catch {
    return toolError(ErrorCode.INVALID_INPUT, 'provider options are not serializable.');
  }
  if (serializedSize > MAX_PROVIDER_BODY_BYTES) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `provider options serialized size (${serializedSize} bytes) exceeds max ${MAX_PROVIDER_BODY_BYTES}. ` +
        'Reduce the number of entries in order, ignore, only, or quantizations arrays.',
    );
  }

  return null;
}

function parseCsv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const arr = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return arr.length > 0 ? arr : undefined;
}

function parseJsonArray(raw: string | undefined, name: string): string[] | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) {
        throw new Error('not a JSON array of strings');
      }
      return parsed.length > 0 ? (parsed as string[]) : undefined;
    } catch (err) {
      throw new Error(
        `${name}: malformed JSON array (${err instanceof Error ? err.message : String(err)})`,
        { cause: err },
      );
    }
  }
  return parseCsv(trimmed);
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const lc = raw.trim().toLowerCase();
  if (lc === 'true' || lc === '1' || lc === 'yes') return true;
  if (lc === 'false' || lc === '0' || lc === 'no') return false;
  return undefined;
}

function parseSort(raw: string | undefined): ProviderSort | undefined {
  if (!raw) return undefined;
  const lc = raw.trim().toLowerCase();
  return lc === 'price' || lc === 'throughput' || lc === 'latency'
    ? (lc as ProviderSort)
    : undefined;
}

function parseDataCollection(raw: string | undefined): DataCollectionPolicy | undefined {
  if (!raw) return undefined;
  const lc = raw.trim().toLowerCase();
  return lc === 'allow' || lc === 'deny' ? (lc as DataCollectionPolicy) : undefined;
}

/**
 * Read provider routing defaults from `OPENROUTER_PROVIDER_*` env vars.
 * Invalid values are silently dropped (never throw at server start).
 */
export function readProviderDefaults(): ProviderRoutingOptions {
  const env = process.env;
  const out: ProviderRoutingOptions = {};
  const quantizations = parseCsv(env.OPENROUTER_PROVIDER_QUANTIZATIONS);
  if (quantizations) out.quantizations = quantizations;
  const ignore = parseCsv(env.OPENROUTER_PROVIDER_IGNORE);
  if (ignore) out.ignore = ignore;
  try {
    const only = parseJsonArray(env.OPENROUTER_PROVIDER_ONLY, 'OPENROUTER_PROVIDER_ONLY');
    if (only) out.only = only;
  } catch (err) {
    logger.warn('OPENROUTER_PROVIDER_ONLY ignored', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  const sort = parseSort(env.OPENROUTER_PROVIDER_SORT);
  if (sort) out.sort = sort;
  try {
    const order = parseJsonArray(env.OPENROUTER_PROVIDER_ORDER, 'OPENROUTER_PROVIDER_ORDER');
    if (order) out.order = order;
  } catch (err) {
    logger.warn('OPENROUTER_PROVIDER_ORDER ignored', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  const requireParams = parseBool(env.OPENROUTER_PROVIDER_REQUIRE_PARAMETERS);
  if (requireParams !== undefined) out.require_parameters = requireParams;
  const dc = parseDataCollection(env.OPENROUTER_PROVIDER_DATA_COLLECTION);
  if (dc) out.data_collection = dc;
  const af = parseBool(env.OPENROUTER_PROVIDER_ALLOW_FALLBACKS);
  if (af !== undefined) out.allow_fallbacks = af;
  return out;
}

/**
 * Merge caller overrides on top of env defaults. Explicit `undefined`
 * values in the override drop back to the default (they don't erase it);
 * to actually erase a field, pass `null`.
 */
export function mergeProviderOptions(
  defaults: ProviderRoutingOptions,
  overrides?: ProviderRoutingOptions,
): ProviderRoutingOptions {
  if (!overrides) return { ...defaults };
  // Guard: reject non-object overrides.  MCP clients that ignore the JSON
  // schema can send strings, arrays, or numbers as `provider`.  Without
  // this check, `Object.entries()` on a string produces one entry per
  // character — a multi-megabyte string exhausts memory during iteration
  // and the subsequent JSON.stringify of the outbound API request.
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    return { ...defaults };
  }
  const out: ProviderRoutingOptions = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    // Block prototype-pollution keys from untrusted MCP args.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * Build the OpenRouter `provider` request-body field from options.
 * Returns `undefined` when nothing is set so we don't send `{}`.
 */
export function buildProviderBody(
  opts: ProviderRoutingOptions,
): Record<string, unknown> | undefined {
  const entries = Object.entries(opts).filter(([, v]) => {
    if (v === undefined || v === null) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

/**
 * Read the default `max_tokens` from `OPENROUTER_MAX_TOKENS` env var.
 * Invalid or non-positive values are ignored.
 */
export function readDefaultMaxTokens(): number | undefined {
  const raw = process.env.OPENROUTER_MAX_TOKENS;
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Resolve the effective `max_tokens` for a request. Request value wins
 * over env default.
 */
export function resolveMaxTokens(requested?: number): number | undefined {
  if (typeof requested === 'number' && requested > 0) return requested;
  return readDefaultMaxTokens();
}
