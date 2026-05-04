import { describe, it, expect, vi } from 'vitest';
import { handleRerankDocuments } from '../tool-handlers/rerank.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

function mockApiClient(response: unknown, throws?: Error) {
  const rerank = vi.fn();
  if (throws) rerank.mockRejectedValue(throws);
  else rerank.mockResolvedValue(response);
  return { rerank } as unknown as OpenRouterAPIClient;
}

describe('handleRerankDocuments', () => {
  it('returns INVALID_INPUT when query is missing', async () => {
    const client = mockApiClient({ results: [] });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: '', documents: ['a'] } } },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when documents array is empty', async () => {
    const client = mockApiClient({ results: [] });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: [] } } },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when any document is non-string', async () => {
    const client = mockApiClient({ results: [] });
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: {
            query: 'q',
            documents: ['ok', 123 as unknown as string],
          },
        },
      },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
  });

  it('calls the API with the right shape', async () => {
    const client = mockApiClient({
      model: 'cohere/rerank-english-v3.0',
      results: [
        { index: 1, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.2 },
      ],
    });
    await handleRerankDocuments(
      {
        params: {
          arguments: {
            query: 'what is the capital of France?',
            documents: ['Paris is the capital.', 'Berlin is in Germany.'],
            top_n: 2,
          },
        },
      },
      client,
    );
    expect(client.rerank).toHaveBeenCalledWith({
      model: 'cohere/rerank-english-v3.0',
      query: 'what is the capital of France?',
      documents: ['Paris is the capital.', 'Berlin is in Germany.'],
      top_n: 2,
    });
  });

  it('normalizes relevance_score to score in the output', async () => {
    const client = mockApiClient({
      results: [{ index: 0, relevance_score: 0.8 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'] } } },
      client,
    );
    const sc = (r as { structuredContent: { results: Array<{ score: number }> } }).structuredContent;
    expect(sc.results[0].score).toBe(0.8);
  });

  it('includes documents when return_documents=true', async () => {
    const client = mockApiClient({
      results: [{ index: 0, score: 0.8 }],
    });
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: { query: 'q', documents: ['hello world'], return_documents: true },
        },
      },
      client,
    );
    const sc = (r as { structuredContent: { results: Array<{ document?: string }> } })
      .structuredContent;
    expect(sc.results[0].document).toBe('hello world');
  });

  it('omits documents by default', async () => {
    const client = mockApiClient({
      results: [{ index: 0, score: 0.8 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['hello'] } } },
      client,
    );
    const sc = (r as { structuredContent: { results: Array<{ document?: string }> } })
      .structuredContent;
    expect(sc.results[0].document).toBeUndefined();
  });

  it('classifies upstream HTTP errors', async () => {
    const client = mockApiClient(null, new Error('POST /rerank failed: HTTP 500'));
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'] } } },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
  });
});
