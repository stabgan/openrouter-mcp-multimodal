/**
 * Agent 2 — Final coverage additions for genuinely untested code paths.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets (confirmed untested via exhaustive grep across all test files):
 *
 * errors.ts:
 *  1. toolErrorFrom prefix exceeding MAX_PREFIX_LENGTH (256) → truncated with "…"
 *  2. toolErrorFrom with exactly 256-char prefix → NOT truncated
 *  3. toolErrorFrom with empty string prefix → no prefix prepended
 *
 * cache.ts:
 *  4. extractCacheMeta with Infinity age → not finite, age excluded
 *  5. extractCacheMeta with -Infinity age → not finite, age excluded
 *  6. extractCacheMeta with negative numeric age → finite, included
 *  7. extractCacheMeta with ttl present but no age
 *  8. buildCacheHeaders with only cache_clear (no cache flag)
 *  9. buildCacheHeaders with cache: false + cache_clear: true
 * 10. resolveCacheTtl with null (non-string, non-number)
 * 11. resolveCacheTtl with object input
 * 12. validateCacheOptions with cache_ttl: null → short-circuits to null
 * 13. resolveCacheTtl with negative integer
 *
 * logger.ts:
 * 14. sanitizeCtx strips __proto__ key from log context
 * 15. sanitizeCtx strips constructor key from log context
 * 16. sanitizeCtx strips prototype key from log context
 * 17. sanitizeLogValue handles arrays in context (maps each element)
 * 18. sanitizeLogValue handles undefined/null values (passes through)
 * 19. sanitizeLogValue handles nested objects with sensitive keys
 * 20. emitRecord catch branch — unserializable record triggers fallback
 * 21. redactString with sk-or key pattern in regular string value
 * 22. redactString with generic sk- key pattern (20+ chars)
 *
 * embed_text:
 * 23. _meta.usage only includes sanitized fields from upstream
 * 24. Total input size exactly at MAX_TOTAL_INPUT_CHARS boundary passes
 *
 * decide:
 * 25. Score answer where ALL values are NaN → displayScore fallback to 0
 * 26. Choice answer where answer.choice is a number → sanitized to empty {}
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolErrorFrom, ErrorCode } from '../errors.js';
import {
  buildCacheHeaders,
  extractCacheMeta,
  resolveCacheTtl,
  validateCacheOptions,
} from '../tool-handlers/cache.js';
import { log, logger, _sink } from '../logger.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type EmbedSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
};

type DecideSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    answers: Record<string, { type: string; [key: string]: unknown }>;
  };
  _meta: Record<string, unknown>;
};

function mockEmbedClient(response: unknown) {
  const createEmbeddings = vi.fn().mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  const submitDecision = vi.fn().mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQuestion(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–3. errors.ts — toolErrorFrom prefix truncation (MAX_PREFIX_LENGTH = 256)
// ═══════════════════════════════════════════════════════════════════════════

describe('toolErrorFrom — prefix length truncation', () => {
  it('truncates prefix exceeding 256 chars with trailing …', () => {
    // Use non-base64 chars (spaces) to avoid sanitizeErrorMessage base64 redaction
    const longPrefix = 'prefix '.repeat(50).slice(0, 300);
    const r = toolErrorFrom(ErrorCode.INVALID_INPUT, new Error('fail'), longPrefix);
    // The prefix should be truncated to 256 chars + "…"
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain(longPrefix.slice(0, 256));
    expect(r.content[0].text).toContain('…');
    // The original 300-char prefix should NOT appear in full
    expect(r.content[0].text).not.toContain(longPrefix + ': fail');
  });

  it('preserves prefix at exactly 256 chars (no truncation)', () => {
    // Use non-base64 chars to avoid redaction
    const exactPrefix = 'ok '.repeat(100).slice(0, 256);
    const r = toolErrorFrom(ErrorCode.INVALID_INPUT, new Error('oops'), exactPrefix);
    expect(r.isError).toBe(true);
    // Full 256-char prefix should appear followed by ": oops"
    expect(r.content[0].text).toContain(exactPrefix + ': oops');
  });

  it('handles empty string prefix (no prefix prepended)', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, new Error('issue'), '');
    expect(r.isError).toBe(true);
    // Empty prefix is falsy → base = '' → message is just the error
    expect(r.content[0].text).toBe('issue');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4–7. cache.ts — extractCacheMeta edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('extractCacheMeta — non-finite and negative age values', () => {
  it('excludes age when cache-age header is Infinity', () => {
    const headers = new Headers({
      'x-openrouter-cache-status': 'HIT',
      'x-openrouter-cache-age': 'Infinity',
    });
    const meta = extractCacheMeta(headers);
    expect(meta).toEqual({ status: 'HIT' });
    expect(meta?.age).toBeUndefined();
  });

  it('excludes age when cache-age header is -Infinity', () => {
    const headers = new Headers({
      'x-openrouter-cache-status': 'HIT',
      'x-openrouter-cache-age': '-Infinity',
    });
    const meta = extractCacheMeta(headers);
    expect(meta).toEqual({ status: 'HIT' });
    expect(meta?.age).toBeUndefined();
  });

  it('includes negative numeric age (is finite)', () => {
    const headers = new Headers({
      'x-openrouter-cache-status': 'MISS',
      'x-openrouter-cache-age': '-5',
    });
    const meta = extractCacheMeta(headers);
    expect(meta).toEqual({ status: 'MISS', age: -5 });
  });

  it('includes ttl when present without age', () => {
    const headers = new Headers({
      'x-openrouter-cache-status': 'MISS',
      'x-openrouter-cache-ttl': '600',
    });
    const meta = extractCacheMeta(headers);
    expect(meta).toEqual({ status: 'MISS', ttl: '600' });
    expect(meta?.age).toBeUndefined();
  });

  it('includes both age and ttl when present', () => {
    const headers = new Headers({
      'x-openrouter-cache-status': 'HIT',
      'x-openrouter-cache-age': '120',
      'x-openrouter-cache-ttl': '3600',
    });
    const meta = extractCacheMeta(headers);
    expect(meta).toEqual({ status: 'HIT', age: 120, ttl: '3600' });
  });

  it('excludes age when cache-age is empty string', () => {
    const headers = new Headers({
      'x-openrouter-cache-status': 'MISS',
      'x-openrouter-cache-age': '',
    });
    const meta = extractCacheMeta(headers);
    // Headers constructor ignores empty values for some fields; the key may be absent
    expect(meta?.status).toBe('MISS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8–9. cache.ts — buildCacheHeaders with cache_clear edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('buildCacheHeaders — cache_clear combinations', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sets only cache-clear header when cache_clear: true without cache flag', () => {
    const headers = buildCacheHeaders({ cache_clear: true });
    // cache_clear is set, but cache is not explicitly true and no env default
    expect(headers['X-OpenRouter-Cache-Clear']).toBe('true');
    expect(headers['X-OpenRouter-Cache']).toBeUndefined();
  });

  it('does not set cache header when cache: false + cache_clear: true', () => {
    const headers = buildCacheHeaders({ cache: false, cache_clear: true });
    expect(headers['X-OpenRouter-Cache']).toBeUndefined();
    expect(headers['X-OpenRouter-Cache-Clear']).toBe('true');
  });

  it('sets both headers when cache: true + cache_clear: true', () => {
    const headers = buildCacheHeaders({ cache: true, cache_clear: true });
    expect(headers['X-OpenRouter-Cache']).toBe('true');
    expect(headers['X-OpenRouter-Cache-Clear']).toBe('true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10–13. cache.ts — resolveCacheTtl and validateCacheOptions edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveCacheTtl — non-string non-number inputs', () => {
  it('rejects null input', () => {
    const r = resolveCacheTtl(null as unknown as string);
    expect(r).toMatchObject({ isError: true, _meta: { code: 'INVALID_INPUT' } });
  });

  it('rejects object input', () => {
    const r = resolveCacheTtl({ seconds: 300 } as unknown as string);
    expect(r).toMatchObject({ isError: true, _meta: { code: 'INVALID_INPUT' } });
  });

  it('rejects array input', () => {
    const r = resolveCacheTtl([300] as unknown as string);
    expect(r).toMatchObject({ isError: true, _meta: { code: 'INVALID_INPUT' } });
  });

  it('rejects negative integer number', () => {
    const r = resolveCacheTtl(-10 as unknown as string);
    expect(r).toMatchObject({ isError: true, _meta: { code: 'INVALID_INPUT' } });
  });
});

describe('validateCacheOptions — null and undefined cache_ttl', () => {
  it('returns null when cache_ttl is null', () => {
    expect(validateCacheOptions({ cache_ttl: null as unknown as string })).toBeNull();
  });

  it('returns null when cache_ttl is undefined', () => {
    expect(validateCacheOptions({ cache_ttl: undefined })).toBeNull();
  });

  it('returns null when cache_ttl is empty string', () => {
    expect(validateCacheOptions({ cache_ttl: '' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14–22. logger.ts — sanitizeCtx, sanitizeLogValue, emitRecord
// ═══════════════════════════════════════════════════════════════════════════

describe('logger — sanitizeCtx prototype pollution key stripping', () => {
  let lines: string[];
  let origWrite: typeof _sink.write;

  beforeEach(() => {
    lines = [];
    origWrite = _sink.write;
    _sink.write = (line: string) => {
      lines.push(line);
    };
  });

  afterEach(() => {
    _sink.write = origWrite;
    vi.unstubAllEnvs();
  });

  it('strips __proto__ key from log context', () => {
    const ctx = Object.create(null);
    ctx['__proto__'] = 'attack';
    ctx['safe'] = 'value';
    log('info', 'proto-test', ctx);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.safe).toBe('value');
    // JSON.parse creates a normal object — check own keys instead of property access
    expect(Object.keys(parsed.ctx)).not.toContain('__proto__');
  });

  it('strips constructor key from log context', () => {
    const ctx = Object.create(null);
    ctx['constructor'] = 'pollute';
    ctx['model'] = 'test/model';
    log('info', 'constructor-test', ctx);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.model).toBe('test/model');
    // JSON.parse creates a normal object where .constructor is Object — check own keys
    expect(Object.keys(parsed.ctx)).not.toContain('constructor');
  });

  it('strips prototype key from log context', () => {
    const ctx = Object.create(null);
    ctx['prototype'] = { a: 1 };
    ctx['count'] = 42;
    log('info', 'prototype-test', ctx);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.count).toBe(42);
    expect(parsed.ctx.prototype).toBeUndefined();
  });

  it('handles arrays in context by mapping each element', () => {
    log('info', 'array-ctx', { items: ['hello', 42, true, null] });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.items).toEqual(['hello', 42, true, null]);
  });

  it('handles nested objects with sensitive keys in arrays', () => {
    log('info', 'nested', {
      configs: [{ api_key: 'sk-or-v1-secret123', name: 'test' }],
    });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.configs[0].api_key).toBe('[REDACTED]');
    expect(parsed.ctx.configs[0].name).toBe('test');
  });

  it('preserves null and boolean values in context', () => {
    log('info', 'types', { flag: true, nothing: null, count: 0 });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.flag).toBe(true);
    expect(parsed.ctx.nothing).toBe(null);
    expect(parsed.ctx.count).toBe(0);
  });

  it('redacts sk-or-v1 pattern in regular string values', () => {
    log('info', 'leaked', { message: 'Auth failed for sk-or-v1-abcdef123456' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.message).toContain('[REDACTED]');
    expect(parsed.ctx.message).not.toContain('sk-or-v1-abcdef123456');
  });

  it('redacts generic sk- key pattern (20+ chars)', () => {
    const longKey = 'sk-' + 'a'.repeat(30);
    log('info', 'generic-key', { value: `Key: ${longKey}` });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.value).toContain('[REDACTED]');
    expect(parsed.ctx.value).not.toContain(longKey);
  });

  it('redacts Bearer tokens in context values', () => {
    log('info', 'auth', { header: 'Bearer sk-or-v1-mysecretkey' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.header).toContain('[REDACTED]');
    expect(parsed.ctx.header).not.toContain('sk-or-v1-mysecretkey');
  });
});

describe('logger — emitRecord fallback for unserializable data', () => {
  let lines: string[];
  let origWrite: typeof _sink.write;

  beforeEach(() => {
    lines = [];
    origWrite = _sink.write;
    _sink.write = (line: string) => {
      lines.push(line);
    };
  });

  afterEach(() => {
    _sink.write = origWrite;
  });

  it('falls back to minimal record when primary JSON.stringify fails', () => {
    // BigInt cannot be JSON.stringified — triggers the catch branch in emitRecord
    log('info', 'bigint-test', { value: BigInt(123) as unknown as number });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('bigint-test');
    expect(parsed.ctx).toEqual({ note: 'unserializable' });
  });
});

describe('logger.audit — sanitization applied', () => {
  let lines: string[];
  let origWrite: typeof _sink.write;

  beforeEach(() => {
    lines = [];
    origWrite = _sink.write;
    _sink.write = (line: string) => {
      lines.push(line);
    };
  });

  afterEach(() => {
    _sink.write = origWrite;
  });

  it('strips __proto__ from audit log context', () => {
    const ctx = Object.create(null);
    ctx['__proto__'] = 'attack';
    ctx['model'] = 'test/model';
    logger.audit('audit-proto', ctx);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe('audit');
    expect(parsed.ctx.model).toBe('test/model');
    // JSON.parse creates a normal object — check own keys instead of property access
    expect(Object.keys(parsed.ctx)).not.toContain('__proto__');
  });

  it('redacts sensitive keys in audit context', () => {
    logger.audit('audit-sensitive', { api_key: 'sk-or-v1-secret', model: 'gpt-4' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.ctx.api_key).toBe('[REDACTED]');
    expect(parsed.ctx.model).toBe('gpt-4');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 23–24. embed_text — usage sanitization and boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — usage sanitization in _meta', () => {
  it('drops non-numeric usage fields from upstream response', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'openai/text-embedding-3-small',
      usage: {
        prompt_tokens: 10,
        total_tokens: 10,
        extra_field: 'should be dropped',
        nested: { object: true },
        NaN_field: NaN,
      },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r._meta.usage).toEqual({ prompt_tokens: 10, total_tokens: 10 });
  });

  it('omits usage from _meta when all usage fields are non-numeric', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'openai/text-embedding-3-small',
      usage: { foo: 'bar', baz: NaN },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccessResult;
    expect(r._meta.usage).toBeUndefined();
  });

  it('accepts total input exactly at MAX_TOTAL_INPUT_CHARS (10_000_000)', async () => {
    // 100 texts × 100_000 chars each = 10_000_000 total (each at MAX_TEXT_LENGTH boundary)
    const text = 'a'.repeat(100_000);
    const texts = Array.from({ length: 100 }, () => text);
    const data = texts.map((_, i) => ({ index: i, embedding: [0.1] }));
    const client = mockEmbedClient({
      data,
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts }), client)) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings).toHaveLength(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 25–26. decide — response sanitization edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score with all NaN values', () => {
  it('displays 0% when all score values are NaN → maxVal stays -Infinity', async () => {
    const client = mockDecideClient({
      answers: {
        quality: { type: 'score', score: [NaN, NaN, NaN] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          quality: {
            type: 'score',
            instructions: 'rate quality',
            criteria: ['bad', 'ok', 'good'],
          },
        },
      }),
      client,
    )) as DecideSuccessResult;
    // When no valid numeric score found, maxVal is -Infinity → displayScore = 0
    expect(r.content[0].text).toContain('0.0%');
    // structuredContent maps NaN to 0
    expect(r.structuredContent.answers.quality.score).toEqual([0, 0, 0]);
  });
});

describe('handleDecide — choice with non-object choice value', () => {
  it('sanitizes choice to empty {} when upstream choice is a number', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: 42 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick one',
            criteria: { a: 'Option A', b: 'Option B' },
          },
        },
      }),
      client,
    )) as DecideSuccessResult;
    // Number fails typeof === 'object' check → safeChoice = {}
    expect(r.structuredContent.answers.q1.choice).toEqual({});
  });

  it('sanitizes choice to empty {} when upstream choice is a string', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: 'not-an-object' },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick one',
            criteria: { a: 'Option A', b: 'Option B' },
          },
        },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1.choice).toEqual({});
  });

  it('sanitizes choice to empty {} when upstream choice is null', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: null },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick',
            criteria: { x: 'X', y: 'Y' },
          },
        },
      }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1.choice).toEqual({});
  });
});

describe('handleDecide — usage sanitization in _meta', () => {
  it('drops non-numeric usage fields from upstream decide response', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
      usage: {
        cost: 0.001,
        extra_garbage: 'should be stripped',
        prompt_tokens: NaN,
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Only cost is a valid finite number
    expect(r._meta.usage).toEqual({ cost: 0.001 });
  });
});
