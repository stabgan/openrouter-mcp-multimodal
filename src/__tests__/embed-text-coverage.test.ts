/**
 * Additional coverage for embed_text — targets validation branches not
 * exercised by the primary embed-text.test.ts:
 *
 * - MAX_TEXT_LENGTH exceeded (100_000 char limit per text element)
 * - Multiple error paths in a single batch (first failing element wins)
 * - Summary text format verification with model fallback
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
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

describe('handleEmbedText — MAX_TEXT_LENGTH validation', () => {
  it('returns INVALID_INPUT when a single text exceeds 100_000 characters', async () => {
    const longText = 'a'.repeat(100_001);
    const r = (await handleEmbedText(req({ texts: longText }), mockApiClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('exceeds max length');
    expect(r.content[0].text).toContain('100000');
    expect(r.content[0].text).toContain('100001');
  });

  it('returns INVALID_INPUT when a text in a batch exceeds 100_000 characters', async () => {
    const longText = 'x'.repeat(100_001);
    const r = (await handleEmbedText(
      req({ texts: ['valid short text', longText] }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
    expect(r.content[0].text).toContain('exceeds max length');
  });

  it('allows text at exactly 100_000 characters', async () => {
    const maxText = 'b'.repeat(100_000);
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.5, 0.6] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(req({ texts: maxText }), client)) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect(r.structuredContent.embeddings).toHaveLength(1);
  });

  it('catches the first failing element in a batch with mixed issues', async () => {
    // Element 0 is valid, element 1 is non-string — should fail on index 1
    const r = (await handleEmbedText(
      req({ texts: ['valid', 42, 'also valid'] }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
  });

  it('catches empty string before length check', async () => {
    // Empty string at index 0 should trigger "empty" error, not length error
    const r = (await handleEmbedText(
      req({ texts: ['', 'valid'] }),
      mockApiClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('empty');
  });
});

describe('handleEmbedText — summary text format', () => {
  it('includes model name from response in summary text', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'cohere/embed-v4',
    });
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as SuccessResult;
    expect(r.content[0].text).toContain('cohere/embed-v4');
  });

  it('falls back to effective model in summary when response.model is empty string', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: '',
    });
    const r = (await handleEmbedText(req({ texts: 'hello' }), client)) as SuccessResult;
    // Empty string is falsy, so it falls back to the default model
    expect(r.content[0].text).toContain('openai/text-embedding-3-small');
  });

  it('falls back to effective model in summary when response.model is undefined', async () => {
    const client = mockApiClient({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4] }],
    });
    const r = (await handleEmbedText(
      req({ texts: 'test', model: 'voyage/voyage-3' }),
      client,
    )) as SuccessResult;
    expect(r.content[0].text).toContain('voyage/voyage-3');
    expect(r.content[0].text).toContain('4 dimensions');
  });
});

describe('handleEmbedText — edge cases in structuredContent', () => {
  it('maps embedding indices correctly from API response', async () => {
    const client = mockApiClient({
      data: [
        { index: 2, embedding: [0.5] },
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.3] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(req({ texts: ['a', 'b', 'c'] }), client)) as SuccessResult;
    // Indices should be preserved as-is from the API
    expect(r.structuredContent.embeddings[0].index).toBe(2);
    expect(r.structuredContent.embeddings[1].index).toBe(0);
    expect(r.structuredContent.embeddings[2].index).toBe(1);
  });

  it('dimensions in structuredContent comes from first embedding length', async () => {
    const client = mockApiClient({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3, 0.4, 0.5] },
        { index: 1, embedding: [0.6, 0.7, 0.8, 0.9, 1.0] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(req({ texts: ['a', 'b'] }), client)) as SuccessResult;
    expect(r.structuredContent.dimensions).toBe(5);
    expect(r._meta.dimensions).toBe(5);
  });
});
