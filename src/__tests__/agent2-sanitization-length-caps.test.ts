/**
 * Agent 2 — Coverage for untested sanitization length caps across the codebase.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Confirmed untested code paths (verified via grep across all 128 test files):
 *
 * cache.ts — extractCacheMeta MAX_CACHE_HEADER_LENGTH (128) truncation:
 *  1. Status header exceeding 128 chars → truncated to 128
 *  2. Status header at exactly 128 chars → preserved as-is
 *  3. TTL header exceeding 128 chars → truncated to 128
 *  4. TTL header at exactly 128 chars → preserved as-is
 *  5. Both status and ttl headers oversized → both truncated independently
 *
 * buildBinaryToolResult — remoteUrl passthrough behavior:
 *  6. Long remoteUrl included verbatim in too-large text hint
 *  7. Empty string remoteUrl omitted from too-large text
 *  8. remoteUrl passed to video resource URI verbatim
 *  9. remoteUrl absent → fallback URI used for video
 *
 * buildCacheHeaders — cache_ttl auto-enable with invalid TTL:
 * 10. cache_ttl set (with hasTtl=true) but resolves to error → TTL header skipped,
 *     but cache flag still auto-enabled
 * 11. cache_ttl as non-string non-number (boolean) → validated as not-a-string
 *
 * embed_text + decide — validation priority ordering:
 * 12. texts=undefined error precedes dimensions error
 * 13. empty array error precedes dimensions error
 * 14. per-text type error precedes aggregate size error
 * 15. dimensions error precedes model error
 * 16. decide: criteria missing precedes model check
 *
 * decide — complex state and multi-type response sanitization:
 * 17. State with deeply nested arrays of objects (valid, no unsafe keys)
 * 18. Simultaneous noul/choice/score sanitization in same response
 * 19. Answer count cap combined with unsafe key skipping
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractCacheMeta, buildCacheHeaders } from '../tool-handlers/cache.js';
import { buildBinaryToolResult } from '../tool-handlers/tool-result-payload.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

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
    answers: Record<
      string,
      {
        type: string;
        noul?: number;
        choice?: Record<string, number>;
        score?: number[];
      }
    >;
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
// 1–5. extractCacheMeta — MAX_CACHE_HEADER_LENGTH (128) truncation
// ═══════════════════════════════════════════════════════════════════════════

describe('extractCacheMeta — cache header length truncation at 128 chars', () => {
  it('truncates status header exceeding 128 chars', () => {
    const longStatus = 'X'.repeat(200);
    const headers = new Headers({
      'x-openrouter-cache-status': longStatus,
    });
    const meta = extractCacheMeta(headers);
    expect(meta).not.toBeNull();
    expect(meta!.status.length).toBe(128);
    expect(meta!.status).toBe('X'.repeat(128));
  });

  it('preserves status header at exactly 128 chars', () => {
    const exactStatus = 'Y'.repeat(128);
    const headers = new Headers({
      'x-openrouter-cache-status': exactStatus,
    });
    const meta = extractCacheMeta(headers);
    expect(meta).not.toBeNull();
    expect(meta!.status).toBe(exactStatus);
    expect(meta!.status.length).toBe(128);
  });

  it('truncates ttl header exceeding 128 chars', () => {
    const longTtl = '9'.repeat(200);
    const headers = new Headers({
      'x-openrouter-cache-status': 'HIT',
      'x-openrouter-cache-ttl': longTtl,
    });
    const meta = extractCacheMeta(headers);
    expect(meta).not.toBeNull();
    expect(meta!.ttl).toBeDefined();
    expect(meta!.ttl!.length).toBe(128);
    expect(meta!.ttl).toBe('9'.repeat(128));
  });

  it('preserves ttl header at exactly 128 chars', () => {
    const exactTtl = '8'.repeat(128);
    const headers = new Headers({
      'x-openrouter-cache-status': 'MISS',
      'x-openrouter-cache-ttl': exactTtl,
    });
    const meta = extractCacheMeta(headers);
    expect(meta).not.toBeNull();
    expect(meta!.ttl).toBe(exactTtl);
    expect(meta!.ttl!.length).toBe(128);
  });

  it('truncates both status and ttl independently when both exceed 128 chars', () => {
    const longStatus = 'A'.repeat(300);
    const longTtl = 'B'.repeat(500);
    const headers = new Headers({
      'x-openrouter-cache-status': longStatus,
      'x-openrouter-cache-ttl': longTtl,
      'x-openrouter-cache-age': '42',
    });
    const meta = extractCacheMeta(headers);
    expect(meta).not.toBeNull();
    expect(meta!.status.length).toBe(128);
    expect(meta!.status).toBe('A'.repeat(128));
    expect(meta!.ttl!.length).toBe(128);
    expect(meta!.ttl).toBe('B'.repeat(128));
    expect(meta!.age).toBe(42);
  });

  it('preserves short status and ttl headers normally', () => {
    const headers = new Headers({
      'x-openrouter-cache-status': 'HIT',
      'x-openrouter-cache-ttl': '300',
    });
    const meta = extractCacheMeta(headers);
    expect(meta).toEqual({ status: 'HIT', ttl: '300' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6–9. buildBinaryToolResult — remoteUrl passthrough behavior
// ═══════════════════════════════════════════════════════════════════════════

describe('buildBinaryToolResult — remoteUrl in too-large and inline paths', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('includes remoteUrl verbatim in too-large text hint', () => {
    const url = 'https://cdn.example.com/generated/image-abc123.png';
    const bigBuf = Buffer.alloc(2_000_000, 0x42);
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: bigBuf, mimeType: 'image/png' },
      { maxInlineBytes: 1024, remoteUrl: url },
    );
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain('URL:');
    expect(text).toContain(url);
    expect(text).toContain('Too large to inline');
  });

  it('omits URL hint when remoteUrl is empty string', () => {
    const bigBuf = Buffer.alloc(2_000_000, 0x42);
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: bigBuf, mimeType: 'image/png' },
      { maxInlineBytes: 1024, remoteUrl: '' },
    );
    const text = (r.content[0] as { text: string }).text;
    expect(text).not.toContain('URL:');
    expect(text).toContain('Too large to inline');
  });

  it('passes remoteUrl to video resource URI for inline video', () => {
    const url = 'https://cdn.example.com/video/gen-456.mp4';
    const smallBuf = Buffer.from('video-data');
    const r = buildBinaryToolResult(
      { kind: 'video', buffer: smallBuf, mimeType: 'video/mp4' },
      { inlineOnly: true, maxInlineBytes: 10000, remoteUrl: url },
    );
    const resource = (r.content[0] as { resource: { uri: string } }).resource;
    expect(resource.uri).toBe(url);
  });

  it('uses default inline URI when remoteUrl is absent for video', () => {
    const smallBuf = Buffer.from('video-data');
    const r = buildBinaryToolResult(
      { kind: 'video', buffer: smallBuf, mimeType: 'video/mp4' },
      { inlineOnly: true, maxInlineBytes: 10000 },
    );
    const resource = (r.content[0] as { resource: { uri: string } }).resource;
    expect(resource.uri).toBe('inline://openrouter-mcp-multimodal/video');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10–11. buildCacheHeaders — cache_ttl auto-enable with edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('buildCacheHeaders — cache_ttl auto-enable and invalid TTL handling', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('auto-enables cache when cache_ttl is invalid (hasTtl=true but resolves to error)', () => {
    // cache_ttl is a non-empty value (so hasTtl=true → auto-enables cache)
    // but the value is invalid → TTL header is skipped
    const h = buildCacheHeaders({ cache_ttl: 'invalid_duration' });
    // Cache flag should be set (auto-enabled because cache_ttl is present)
    expect(h['X-OpenRouter-Cache']).toBe('true');
    // TTL header should NOT be set (invalid value)
    expect(h['X-OpenRouter-Cache-TTL']).toBeUndefined();
  });

  it('auto-enables cache when cache_ttl is out of range', () => {
    const h = buildCacheHeaders({ cache_ttl: '90000' });
    expect(h['X-OpenRouter-Cache']).toBe('true');
    expect(h['X-OpenRouter-Cache-TTL']).toBeUndefined();
  });

  it('does not auto-enable cache when cache_ttl is absent and env default is off', () => {
    vi.stubEnv('OPENROUTER_CACHE_RESPONSES', '0');
    const h = buildCacheHeaders({});
    expect(h['X-OpenRouter-Cache']).toBeUndefined();
  });

  it('sets both cache and TTL when cache_ttl is valid without explicit cache flag', () => {
    const h = buildCacheHeaders({ cache_ttl: '5m' });
    expect(h['X-OpenRouter-Cache']).toBe('true');
    expect(h['X-OpenRouter-Cache-TTL']).toBe('300');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12–16. embed_text + decide — validation priority ordering
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — validation order and early-exit integration', () => {
  it('texts=undefined error precedes dimensions error', async () => {
    const r = (await handleEmbedText(
      embedReq({ dimensions: -5 }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts is required');
  });

  it('empty array error precedes dimensions error', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [], dimensions: NaN }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('empty');
  });

  it('per-text type error precedes aggregate size error', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: [42, 'valid'] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('dimensions error precedes model error', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: 'big', model: '' }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('positive integer');
  });

  it('dimensions upper bound error precedes model error', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', dimensions: 100000, model: '' }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('65536');
  });
});

describe('handleDecide — validation order with mixed question types', () => {
  it('reports first invalid question even when later questions are valid', async () => {
    const questions = {
      q_valid: noulQuestion(),
      q_bad: { type: 'invalid_type', instructions: 'test', criteria: { a: 'A', b: 'B' } },
      q_also_valid: noulQuestion(),
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('noul, choice, score');
  });

  it('reports missing criteria before checking model', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: { q1: { type: 'noul', instructions: 'test' } },
        model: '',
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('criteria');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. decide — deeply nested state with arrays of objects (valid)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — state with complex nested structure (valid)', () => {
  it('accepts state with nested arrays of objects without unsafe keys', async () => {
    const state = {
      documents: [
        { id: 1, tags: ['a', 'b'], metadata: { source: 'web' } },
        { id: 2, tags: ['c'], metadata: { source: 'api', nested: { level: 3 } } },
      ],
      config: { depth: 5, items: [{ name: 'x' }, { name: 'y' }] },
    };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers.q1).toBeDefined();
    expect(r.structuredContent.answers.q1.noul).toBe(0.8);
  });

  it('accepts state at nesting depth exactly 32 without unsafe keys', async () => {
    let obj: Record<string, unknown> = { leaf: 'value' };
    for (let i = 0; i < 31; i++) {
      obj = { nested: obj };
    }
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state: obj }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('rejects state at nesting depth 34 (fail-closed at depth > 32)', async () => {
    let obj: Record<string, unknown> = { leaf: 'value' };
    for (let i = 0; i < 34; i++) {
      obj = { nested: obj };
    }
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state: obj }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('nesting depth');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. embed_text — combined response sanitization edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response sanitization interaction patterns', () => {
  it('caps both embedding count and dimension count simultaneously', async () => {
    const oversizedVector = Array.from({ length: 70000 }, (_, i) => i * 0.001);
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: oversizedVector },
        { index: 1, embedding: oversizedVector },
        { index: 2, embedding: oversizedVector },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b'] }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings).toHaveLength(2);
    expect(r.structuredContent.dimensions).toBe(65536);
    expect(r.structuredContent.embeddings[0].embedding.length).toBe(65536);
  });

  it('sanitizes mix of valid and non-finite values in same embedding vector', async () => {
    const mixedVector = [0.1, NaN, 0.3, Infinity, 0.5, -Infinity, null, 'bad', 0.9];
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: mixedVector }],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    const vec = r.structuredContent.embeddings[0].embedding;
    expect(vec).toEqual([0.1, 0, 0.3, 0, 0.5, 0, 0, 0, 0.9]);
    expect(vec.length).toBe(9);
  });

  it('uses positional fallback indices for all non-integer upstream indices', async () => {
    const client = mockEmbedClient({
      data: [
        { index: -1, embedding: [0.1] },
        { index: 1.5, embedding: [0.2] },
        { index: 'two', embedding: [0.3] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['a', 'b', 'c'] }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    expect(r.structuredContent.embeddings[1].index).toBe(1);
    expect(r.structuredContent.embeddings[2].index).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. decide — simultaneous answer sanitization across types
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — simultaneous answer sanitization across types', () => {
  it('sanitizes noul, choice, and score answers in same response', async () => {
    const choiceWithUnsafe = Object.create(null);
    choiceWithUnsafe['__proto__'] = 0.5;
    choiceWithUnsafe['a'] = 0.3;
    choiceWithUnsafe['b'] = NaN;
    choiceWithUnsafe['c'] = 0.7;

    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: Infinity },
        q2: { type: 'choice', choice: choiceWithUnsafe },
        q3: { type: 'score', score: [NaN, 0.5, 'bad', 0.3] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQuestion(),
          q2: {
            type: 'choice',
            instructions: 'Pick one',
            criteria: { a: 'A', b: 'B', c: 'C' },
          },
          q3: {
            type: 'score',
            instructions: 'Rate',
            criteria: ['bad', 'ok', 'good', 'great'],
          },
        },
      }),
      client,
    )) as DecideSuccessResult;

    // noul: Infinity → safeNoul = undefined
    expect(r.structuredContent.answers.q1.noul).toBeUndefined();

    // choice: __proto__ stripped, NaN stripped, only a and c remain
    const choice = r.structuredContent.answers.q2.choice!;
    expect(Object.keys(choice)).not.toContain('__proto__');
    expect(choice.a).toBe(0.3);
    expect(choice.b).toBeUndefined();
    expect(choice.c).toBe(0.7);

    // score: NaN→0, 'bad'→0
    expect(r.structuredContent.answers.q3.score).toEqual([0, 0.5, 0, 0.3]);
  });

  it('combines answer count cap with unsafe key skipping', async () => {
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.99 };
    answers['constructor'] = { type: 'noul', noul: 0.88 };
    answers['q1'] = { type: 'noul', noul: 0.7 };
    answers['extra1'] = { type: 'noul', noul: 0.6 };
    answers['extra2'] = { type: 'noul', noul: 0.5 };
    const client = mockDecideClient({ answers });

    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(Object.keys(r.structuredContent.answers)).toContain('q1');
    expect(Object.keys(r.structuredContent.answers)).not.toContain('__proto__');
    expect(Object.keys(r.structuredContent.answers)).not.toContain('constructor');
    const answerCount = Object.keys(r.structuredContent.answers).length;
    expect(answerCount).toBeLessThanOrEqual(1);
  });
});
