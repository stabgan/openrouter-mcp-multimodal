/**
 * OpenRouter provider routing. Merges caller-supplied `provider` args on
 * top of env-var defaults and emits the `provider` object that goes into
 * `POST /chat/completions`. See
 * https://openrouter.ai/docs/features/provider-routing for the spec.
 *
 * Precedence: explicit tool arg > env var > unset. Empty arrays / empty
 * objects are dropped so we don't send noise to the API.
 */

export type ProviderSort = 'price' | 'throughput' | 'latency';
export type DataCollectionPolicy = 'allow' | 'deny';

export interface ProviderRoutingOptions {
  /** Filter providers by quantization (e.g. `['fp16', 'int8']`). */
  quantizations?: string[];
  /** Exclude these provider slugs (e.g. `['openai', 'anthropic']`). */
  ignore?: string[];
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
  // If the value looks like a JSON array (`[...]`), require it to BE valid JSON.
  // Otherwise fall back to CSV parsing — that way `a,b,c` works too, but a
  // malformed `[bogus]` doesn't silently become a single-element string array.
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
  return lc === 'price' || lc === 'throughput' || lc === 'latency' ? (lc as ProviderSort) : undefined;
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
  const sort = parseSort(env.OPENROUTER_PROVIDER_SORT);
  if (sort) out.sort = sort;
  try {
    const order = parseJsonArray(env.OPENROUTER_PROVIDER_ORDER, 'OPENROUTER_PROVIDER_ORDER');
    if (order) out.order = order;
  } catch {
    /* silently drop malformed env var */
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
  const out: ProviderRoutingOptions = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
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
