/**
 * Agent 2 — Final coverage round 2: genuine untested code paths.
 *
 * PARALLEL FLEET AWARENESS: Multiple agents may be editing concurrently.
 * This file ONLY adds tests in src/__tests__/ — it does NOT modify source code.
 *
 * Confirmed untested paths (verified via exhaustive grep of all test files):
 *
 * model-cache.ts — getCacheTtlMs() env parsing edge cases:
 *  1. OPENROUTER_MODEL_CACHE_TTL_MS = 'abc' (non-numeric) → falls back to 3600000
 *  2. OPENROUTER_MODEL_CACHE_TTL_MS = '0' (zero) → not > 0 → falls back to 3600000
 *  3. OPENROUTER_MODEL_CACHE_TTL_MS = '-100' (negative) → not > 0 → falls back to 3600000
 *  4. OPENROUTER_MODEL_CACHE_TTL_MS = 'NaN' → parseInt returns NaN → falls back
 *
 * model-cache.ts — buildMatcher query whitespace trimming:
 *  5. search with query '  gpt  ' → trims to 'gpt' → matches 'openai/gpt-4'
 *  6. search with query consisting only of spaces → treated as no query (all results)
 *
 * model-cache.ts — buildMatcher provider trailing slash stripping:
 *  7. search with provider 'openai/' → strips to 'openai' → matches models with 'openai/' prefix
 *  8. search with provider 'openai///' → multiple slashes stripped → still matches
 *
 * model-cache.ts — buildMatcher name matching (distinct from id matching):
 *  9. search by model name substring (not id) → matches via name field
 *
 * model-cache.ts — lookup with empty string:
 * 10. lookup('') → returns null (guarded by if (!id) return null)
 *
 * model-cache.ts — size() after setModels:
 * 11. size() returns correct count after setModels
 *
 * provider-routing.ts — readProviderDefaults with malformed OPENROUTER_PROVIDER_ORDER:
 * 12. Malformed JSON array for OPENROUTER_PROVIDER_ORDER → silently dropped
 *
 * provider-routing.ts — readProviderDefaults env var combinations:
 * 13. OPENROUTER_PROVIDER_SORT = 'invalid' → silently dropped
 * 14. OPENROUTER_PROVIDER_DATA_COLLECTION = 'invalid' → silently dropped
 * 15. OPENROUTER_PROVIDER_ALLOW_FALLBACKS = 'no' → false
 * 16. OPENROUTER_PROVIDER_REQUIRE_PARAMETERS = 'yes' → true
 *
 * provider-routing.ts — buildProviderBody with null/empty arrays:
 * 17. buildProviderBody with all-empty arrays → returns undefined
 * 18. buildProviderBody with null values → filtered out
 *
 * provider-routing.ts — resolveMaxTokens edge cases:
 * 19. resolveMaxTokens with negative number → falls through to env
 * 20. resolveMaxTokens with NaN → falls through to env
 *
 * embed_text — dimensions at exactly 1 (boundary):
 * 21. dimensions = 1 → accepted (minimum valid positive integer)
 *
 * decide — question name at exactly 256 chars with truncation in error message:
 * 22. question with type as number (not string) → 'Got: 42'
 *
 * decide — state with empty object → accepted, passed to API:
 * 23. state = {} → valid, not rejected
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModelCache } from '../model-cache.js';
import {
  readProviderDefaults,
  buildProviderBody,
  resolveMaxTokens,
  type ProviderRoutingOptions,
} from '../tool-handlers/provider-routing.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ─── Helpers ─────────────────────────────────────────────────────────────

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  return {
    submitDecision: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQ(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–4. model-cache.ts — getCacheTtlMs() env parsing edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('ModelCache — getCacheTtlMs env parsing edge cases', () => {
  let cache: ModelCache;

  beforeEach(() => {
    vi.unstubAllEnvs();
    cache = ModelCache.getInstance();
    cache.reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to default TTL when env var is non-numeric string', () => {
    vi.stubEnv('OPENROUTER_MODEL_CACHE_TTL_MS', 'abc');
    // The default TTL is 3600000ms (1 hour). With a non-numeric value,
    // parseInt returns NaN → !Number.isFinite(NaN) → fallback.
    // Set models and verify cache stays valid (using default TTL, not 0).
    cache.setModels([{ id: 'test/model' }]);
    expect(cache.isValid()).toBe(true);
  });

  it('falls back to default TTL when env var is zero', () => {
    vi.stubEnv('OPENROUTER_MODEL_CACHE_TTL_MS', '0');
    // parseInt('0') = 0 → n > 0 is false → fallback to default.
    cache.setModels([{ id: 'test/model' }]);
    expect(cache.isValid()).toBe(true);
  });

  it('falls back to default TTL when env var is negative', () => {
    vi.stubEnv('OPENROUTER_MODEL_CACHE_TTL_MS', '-100');
    // parseInt('-100') = -100 → not > 0 → fallback.
    cache.setModels([{ id: 'test/model' }]);
    expect(cache.isValid()).toBe(true);
  });

  it('falls back to default TTL when env var is NaN-producing string', () => {
    vi.stubEnv('OPENROUTER_MODEL_CACHE_TTL_MS', 'NaN');
    cache.setModels([{ id: 'test/model' }]);
    expect(cache.isValid()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5–6. model-cache.ts — buildMatcher query whitespace trimming
// ═══════════════════════════════════════════════════════════════════════════

describe('ModelCache.search — query whitespace trimming', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.reset();
    cache.setModels([
      { id: 'openai/gpt-4', name: 'GPT-4' },
      { id: 'anthropic/claude-3', name: 'Claude 3' },
      { id: 'meta/llama-3', name: 'Llama 3' },
    ]);
  });

  it('trims leading/trailing whitespace from query before matching', () => {
    const results = cache.search({ query: '  gpt  ' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('openai/gpt-4');
  });

  it('treats whitespace-only query as no query (returns all models)', () => {
    const all = cache.search({ query: '   ' });
    expect(all).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7–8. model-cache.ts — buildMatcher provider trailing slash stripping
// ═══════════════════════════════════════════════════════════════════════════

describe('ModelCache.search — provider trailing slash stripping', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.reset();
    cache.setModels([
      { id: 'openai/gpt-4', name: 'GPT-4' },
      { id: 'openai/gpt-3.5', name: 'GPT-3.5' },
      { id: 'anthropic/claude-3', name: 'Claude 3' },
    ]);
  });

  it('strips trailing slash from provider filter', () => {
    const results = cache.search({ provider: 'openai/' });
    expect(results).toHaveLength(2);
    expect(results.every((m) => m.id.startsWith('openai/'))).toBe(true);
  });

  it('strips multiple trailing slashes from provider filter', () => {
    const results = cache.search({ provider: 'openai///' });
    expect(results).toHaveLength(2);
  });

  it('trims whitespace from provider filter', () => {
    const results = cache.search({ provider: '  anthropic  ' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('anthropic/claude-3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. model-cache.ts — buildMatcher name matching (distinct from id)
// ═══════════════════════════════════════════════════════════════════════════

describe('ModelCache.search — name-based matching', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.reset();
    cache.setModels([
      { id: 'openai/gpt-4o', name: 'GPT-4o (Turbo)' },
      { id: 'meta/llama-3', name: 'Meta Llama 3 Instruct' },
    ]);
  });

  it('matches by model name when query does not match id', () => {
    // "Turbo" appears in name only, not in id
    const results = cache.search({ query: 'turbo' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('openai/gpt-4o');
  });

  it('matches by model name case-insensitively', () => {
    const results = cache.search({ query: 'INSTRUCT' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('meta/llama-3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10–11. model-cache.ts — lookup('') and size()
// ═══════════════════════════════════════════════════════════════════════════

describe('ModelCache — lookup and size edge cases', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.reset();
  });

  it('returns null for lookup with empty string', () => {
    cache.setModels([{ id: 'openai/gpt-4o' }]);
    expect(cache.lookup('')).toBeNull();
  });

  it('returns correct size after setModels', () => {
    cache.setModels([{ id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' }]);
    expect(cache.size()).toBe(3);
  });

  it('returns 0 size after reset', () => {
    cache.setModels([{ id: 'a/1' }]);
    cache.reset();
    expect(cache.size()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. provider-routing.ts — readProviderDefaults with malformed ORDER
// ═══════════════════════════════════════════════════════════════════════════

describe('readProviderDefaults — malformed OPENROUTER_PROVIDER_ORDER', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('silently drops malformed JSON in OPENROUTER_PROVIDER_ORDER', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_ORDER', '[not valid json');
    const defaults = readProviderDefaults();
    // Malformed JSON → caught → logged → order is undefined
    expect(defaults.order).toBeUndefined();
  });

  it('silently drops JSON array of non-strings in OPENROUTER_PROVIDER_ORDER', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_ORDER', '[1, 2, 3]');
    const defaults = readProviderDefaults();
    expect(defaults.order).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13–16. provider-routing.ts — readProviderDefaults env var combinations
// ═══════════════════════════════════════════════════════════════════════════

describe('readProviderDefaults — env var parsing', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('drops invalid OPENROUTER_PROVIDER_SORT value', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_SORT', 'invalid');
    const defaults = readProviderDefaults();
    expect(defaults.sort).toBeUndefined();
  });

  it('drops invalid OPENROUTER_PROVIDER_DATA_COLLECTION value', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_DATA_COLLECTION', 'maybe');
    const defaults = readProviderDefaults();
    expect(defaults.data_collection).toBeUndefined();
  });

  it('parses OPENROUTER_PROVIDER_ALLOW_FALLBACKS = "no" as false', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_ALLOW_FALLBACKS', 'no');
    const defaults = readProviderDefaults();
    expect(defaults.allow_fallbacks).toBe(false);
  });

  it('parses OPENROUTER_PROVIDER_REQUIRE_PARAMETERS = "yes" as true', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_REQUIRE_PARAMETERS', 'yes');
    const defaults = readProviderDefaults();
    expect(defaults.require_parameters).toBe(true);
  });

  it('parses OPENROUTER_PROVIDER_SORT = "throughput"', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_SORT', 'throughput');
    const defaults = readProviderDefaults();
    expect(defaults.sort).toBe('throughput');
  });

  it('parses OPENROUTER_PROVIDER_DATA_COLLECTION = "deny"', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_DATA_COLLECTION', 'deny');
    const defaults = readProviderDefaults();
    expect(defaults.data_collection).toBe('deny');
  });

  it('parses comma-separated OPENROUTER_PROVIDER_QUANTIZATIONS', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_QUANTIZATIONS', 'fp16, int8, bf16');
    const defaults = readProviderDefaults();
    expect(defaults.quantizations).toEqual(['fp16', 'int8', 'bf16']);
  });

  it('parses comma-separated OPENROUTER_PROVIDER_IGNORE', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_IGNORE', 'openai,anthropic');
    const defaults = readProviderDefaults();
    expect(defaults.ignore).toEqual(['openai', 'anthropic']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17–18. provider-routing.ts — buildProviderBody filtering
// ═══════════════════════════════════════════════════════════════════════════

describe('buildProviderBody — filtering empty/null values', () => {
  it('returns undefined when all arrays are empty', () => {
    const opts: ProviderRoutingOptions = {
      order: [],
      ignore: [],
      only: [],
      quantizations: [],
    };
    expect(buildProviderBody(opts)).toBeUndefined();
  });

  it('returns undefined when all values are undefined', () => {
    const opts: ProviderRoutingOptions = {};
    expect(buildProviderBody(opts)).toBeUndefined();
  });

  it('filters out null values', () => {
    const opts = { sort: 'price', order: null } as unknown as ProviderRoutingOptions;
    const body = buildProviderBody(opts);
    expect(body).toBeDefined();
    expect(body!.sort).toBe('price');
    expect(body!.order).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19–20. provider-routing.ts — resolveMaxTokens edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveMaxTokens — edge cases', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('falls through to env when requested value is negative', () => {
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '4096');
    expect(resolveMaxTokens(-1)).toBe(4096);
  });

  it('falls through to env when requested value is NaN', () => {
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '2048');
    expect(resolveMaxTokens(NaN)).toBe(2048);
  });

  it('returns undefined when both request and env are absent', () => {
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '');
    expect(resolveMaxTokens()).toBeUndefined();
  });

  it('returns undefined when request is 0 and env is empty', () => {
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '');
    expect(resolveMaxTokens(0)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 21. embed_text — dimensions at exactly 1 (minimum boundary)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — dimensions boundary at 1', () => {
  it('accepts dimensions = 1 (minimum valid positive integer)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: 1 }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 1 }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 22. decide — question type as number in error message
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — question type as number', () => {
  it('includes the numeric type value in error message via String()', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: { type: 42, instructions: 'test', criteria: { a: '1', b: '2' } },
        },
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    // The error message uses String(q.type) → '42'
    expect(r.content[0].text).toContain('42');
    expect(r.content[0].text).toContain('noul, choice, score');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 23. decide — empty state object is accepted
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — empty state object', () => {
  it('accepts empty state {} without error', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, state: {} }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    // Verify state was passed to the API
    expect(client.submitDecision).toHaveBeenCalledWith(expect.objectContaining({ state: {} }));
  });
});
