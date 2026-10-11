import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { SERVER_VERSION } from '../version.js';

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
};

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

function mockApiClient(response: unknown, throws?: Error) {
  const createEmbeddings = vi.fn();
  if (throws) createEmbeddings.mockRejectedValue(throws);
  else createEmbeddings.mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function req(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

describe('handleEmbedText', () => {
  // ── Validation: texts ──────────────────────────────────────────────

  it('returns INVALID_INPUT when texts is undefined', async () => {
    const r = (await handleEmbedText(req({}), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts is required');
  });

  it('returns INVALID_INPUT when texts is null', async () => {
    const r = (await handleEmbedText(req({ texts: null }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT for empty array', async () => {
    const r = (await handleEmbedText(req({ texts: [] }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('empty');
  });

  it('returns INVALID_INPUT when texts exceed MAX_TEXTS (2048)', async () => {
    const bigArray = Array.from({ length: 2049 }, (_, i) => `text ${i}`);
    const r = (await handleEmbedText(req({ texts: bigArray }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('2049');
    expect(r.content[0].text).toContain('2048');
  });

  it('allows exactly 2048 texts', async () => {
    const texts = Array.from({ length: 2048 }, (_, i) => `text ${i}`);
    const client = mockApiClient({
      data: texts.map((_, i) => ({ index: i, embedding: [0.1] })),
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(req({ texts }), client)) as SuccessResult;
    expect(r.content).toBeDefined();
    expect(r.structuredContent.embeddings).toHaveLength(2048);
  });

  it('returns INVALID_INPUT when a text element is not a string', async () => {
    const r = (await handleEmbedText(
      req({ texts: ['valid', 123] }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
  });

  it('returns INVALID_INPUT for non-string at index 0', async () => {
    const r = (await handleEmbedText(req({ texts: [false] }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('texts[0]');
  });

  it('returns INVALID_INPUT when a text is empty string', async () => {
    const r = (await handleEmbedText(
      req({ texts: ['hello', ''] }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
    expect(r.content[0].text).toContain('empty');
  });

  it('returns INVALID_INPUT for whitespace-only text', async () => {
    const r = (await handleEmbedText(
      req({ texts: ['  \t\n  '] }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('empty');
  });

  // ── Validation: dimensions ─────────────────────────────────────────

  it('returns INVALID_INPUT for non-number dimensions', async () => {
    const r = (await handleEmbedText(
      req({ texts: 'hello', dimensions: 'big' }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for zero dimensions', async () => {
    const r = (await handleEmbedText(
      req({ texts: 'hello', dimensions: 0 }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for negative dimensions', async () => {
    const r = (await handleEmbedText(
      req({ texts: 'hello', dimensions: -5 }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for non-integer dimensions', async () => {
    const r = (await handleEmbedText(
      req({ texts: 'hello', dimensions: 1.5 }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for NaN dimensions', async () => {
    const r = (await handleEmbedText(
      req({ texts: 'hello', dimensions: NaN }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('positive integer');
  });

  it('returns INVALID_INPUT for Infinity dimensions', async () => {
    const r = (await handleEmbedText(
      req({ texts: 'hello', dimensions: Infinity }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('positive integer');
  });

  it('accepts valid positive integer dimensions', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(
      req({ texts: 'hello', dimensions: 256 }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 256 }),
    );
  });

  // ── Validation: model ──────────────────────────────────────────────

  it('returns INVALID_INPUT for empty model string', async () => {
    const r = (await handleEmbedText(
      req({ texts: 'hello', model: '' }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT for whitespace-only model', async () => {
    const r = (await handleEmbedText(
      req({ texts: 'hello', model: '   ' }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('non-empty string');
  });

  it('returns INVALID_INPUT for non-string model', async () => {
    const r = (await handleEmbedText(
      req({ texts: 'hello', model: 42 }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('non-empty string');
  });

  // ── Default model ──────────────────────────────────────────────────

  it('uses default model when none is specified', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
    });
    await handleEmbedText(req({ texts: 'hello' }), client);
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/text-embedding-3-small' }),
    );
  });

  it('trims model before passing to the API', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'voyage/voyage-3',
    });
    await handleEmbedText(req({ texts: 'hello', model: '  voyage/voyage-3  ' }), client);
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'voyage/voyage-3' }),
    );
  });

  // ── Single string input normalization ──────────────────────────────

  it('wraps a single string in an array before calling the API', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'openai/text-embedding-3-small',
    });
    await handleEmbedText(req({ texts: 'single text' }), client);
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ input: ['single text'] }),
    );
  });

  // ── Successful responses ───────────────────────────────────────────

  it('returns correct structuredContent shape for single embedding', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as SuccessResult;

    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
    expect(r.content[0].text).toContain('1 embedding(s)');
    expect(r.content[0].text).toContain('3 dimensions');

    expect(r.structuredContent.embeddings).toHaveLength(1);
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
    expect(r.structuredContent.dimensions).toBe(3);
  });

  it('returns correct structuredContent for batch embeddings', async () => {
    const client = mockApiClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: [0.3, 0.4] },
        { index: 2, embedding: [0.5, 0.6] },
      ],
      model: 'cohere/embed-v4',
    });
    const r = (await handleEmbedText(req({ texts: ['a', 'b', 'c'] }), client)) as SuccessResult;

    expect(r.structuredContent.embeddings).toHaveLength(3);
    expect(r.structuredContent.model).toBe('cohere/embed-v4');
    expect(r.structuredContent.dimensions).toBe(2);
    expect(r.content[0].text).toContain('3 embedding(s)');
  });

  // ── _meta shape ────────────────────────────────────────────────────

  it('includes correct _meta fields', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });
    const r = (await handleEmbedText(req({ texts: 'test' }), client)) as SuccessResult;

    expect(r._meta.server_version).toBe(SERVER_VERSION);
    expect(r._meta.model).toBe('openai/text-embedding-3-small');
    expect(r._meta.embedding_count).toBe(1);
    expect(r._meta.dimensions).toBe(1);
    expect(r._meta.usage).toEqual({ prompt_tokens: 10, total_tokens: 10 });
  });

  it('omits usage from _meta when not present in response', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(req({ texts: 'test' }), client)) as SuccessResult;
    expect(r._meta.usage).toBeUndefined();
  });

  it('uses effective model when response.model is missing', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
    });
    const r = (await handleEmbedText(
      req({ texts: 'test', model: 'voyage/voyage-3' }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.model).toBe('voyage/voyage-3');
    expect(r._meta.model).toBe('voyage/voyage-3');
  });

  // ── No embeddings returned ─────────────────────────────────────────

  it('returns INTERNAL when API returns empty data', async () => {
    const client = mockApiClient({ data: [] });
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  it('returns INTERNAL when API returns no data field', async () => {
    const client = mockApiClient({});
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
  });

  // ── Upstream errors ────────────────────────────────────────────────

  it('classifies upstream HTTP errors', async () => {
    const client = mockApiClient(null, new Error('POST /embeddings failed: HTTP 500'));
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
  });

  it('classifies auth errors from upstream', async () => {
    const err = new Error('invalid api key') as Error & { status: number };
    err.status = 401;
    const client = mockApiClient(null, err);
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('classifies model not found errors from upstream', async () => {
    const err = new Error('model does not exist') as Error & { status: number };
    err.status = 404;
    const client = mockApiClient(null, err);
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
  });

  // ── API call shape ─────────────────────────────────────────────────

  it('passes input array and dimensions to the API', async () => {
    const client = mockApiClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
      ],
    });
    await handleEmbedText(
      req({ texts: ['one', 'two'], model: 'test/model', dimensions: 512 }),
      client,
    );
    expect(client.createEmbeddings).toHaveBeenCalledWith({
      model: 'test/model',
      input: ['one', 'two'],
      dimensions: 512,
    });
  });

  it('omits dimensions from API call when not specified', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1] }],
    });
    await handleEmbedText(req({ texts: 'hello' }), client);
    expect(client.createEmbeddings).toHaveBeenCalledWith({
      model: 'openai/text-embedding-3-small',
      input: ['hello'],
      dimensions: undefined,
    });
  });

  // ── Validation: per-text length ──────────────────────────────────────

  it('returns INVALID_INPUT when a text exceeds MAX_TEXT_LENGTH (100_000)', async () => {
    const longText = 'a'.repeat(100_001);
    const r = (await handleEmbedText(req({ texts: [longText] }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('100000');
    expect(r.content[0].text).toContain('100001');
  });

  it('allows text at exactly MAX_TEXT_LENGTH (100_000)', async () => {
    const exactText = 'a'.repeat(100_000);
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(req({ texts: [exactText] }), client)) as SuccessResult;
    expect(r.content).toBeDefined();
    expect(r.structuredContent.embeddings).toHaveLength(1);
  });

  // ── Validation: aggregate input size ───────────────────────────────

  it('returns INVALID_INPUT when total input chars exceed MAX_TOTAL_INPUT_CHARS', async () => {
    // 200 texts × 50_001 chars = 10_000_200 > 10_000_000
    const bigText = 'a'.repeat(50_001);
    const texts = Array.from({ length: 200 }, () => bigText);
    const r = (await handleEmbedText(req({ texts }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('Total input size');
    expect(r.content[0].text).toContain('10000000');
  });

  // ── Validation: dimensions upper bound ─────────────────────────────

  it('returns INVALID_INPUT when dimensions exceed 65536', async () => {
    const r = (await handleEmbedText(
      req({ texts: 'hello', dimensions: 65537 }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('65537');
    expect(r.content[0].text).toContain('65536');
  });

  it('accepts dimensions at exactly 65536', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(
      req({ texts: 'hello', dimensions: 65536 }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });

  // ── Validation: model length ───────────────────────────────────────

  it('returns INVALID_INPUT when model exceeds MAX_MODEL_ID_LENGTH (256)', async () => {
    const longModel = 'a'.repeat(257);
    const r = (await handleEmbedText(
      req({ texts: 'hello', model: longModel }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('257');
  });

  it('accepts model at exactly MAX_MODEL_ID_LENGTH (256)', async () => {
    const exactModel = 'a'.repeat(256);
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: exactModel,
    });
    const r = (await handleEmbedText(
      req({ texts: 'hello', model: exactModel }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
  });

  // ── Malformed embedding responses ──────────────────────────────────

  it('returns INTERNAL when first embedding has no embedding field', async () => {
    const client = mockApiClient({
      data: [{ index: 0 }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  it('returns INTERNAL when first embedding has empty embedding array', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  it('returns INTERNAL when first embedding has non-array embedding', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: 'not an array' }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  it('returns INTERNAL when first element in data is null', async () => {
    const client = mockApiClient({
      data: [null],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('unexpected shape');
  });

  // ── Arguments fallback ─────────────────────────────────────────────

  it('handles missing arguments gracefully', async () => {
    const r = (await handleEmbedText(
      { params: { arguments: undefined as unknown as { texts: string } } },
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});
