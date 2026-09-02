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
      model: 'cohere/rerank-v3.5',
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
      model: 'cohere/rerank-v3.5',
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
    const sc = (r as { structuredContent: { results: Array<{ score: number }> } })
      .structuredContent;
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

  it('returns INVALID_INPUT for top_n of 0', async () => {
    const client = mockApiClient({ results: [] });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'], top_n: 0 } } },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect(client.rerank).not.toHaveBeenCalled();
  });

  it('returns INVALID_INPUT for negative top_n', async () => {
    const client = mockApiClient({ results: [] });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'], top_n: -3 } } },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(client.rerank).not.toHaveBeenCalled();
  });

  it('passes top_n greater than document count to the API unchanged', async () => {
    const client = mockApiClient({ results: [{ index: 0, score: 0.5 }] });
    await handleRerankDocuments(
      {
        params: {
          arguments: { query: 'q', documents: ['only one'], top_n: 99 },
        },
      },
      client,
    );
    expect(client.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ top_n: 99, documents: ['only one'] }),
    );
  });

  it('maps result indices back to the original documents array (0-based)', async () => {
    const docs = ['alpha', 'beta', 'gamma'];
    const client = mockApiClient({
      results: [
        { index: 2, score: 0.95 },
        { index: 0, score: 0.4 },
      ],
    });
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: { query: 'q', documents: docs, return_documents: true },
        },
      },
      client,
    );
    const results = (
      r as { structuredContent: { results: Array<{ index: number; document: string }> } }
    ).structuredContent.results;
    expect(results[0]).toMatchObject({ index: 2, document: 'gamma' });
    expect(results[1]).toMatchObject({ index: 0, document: 'alpha' });
  });

  it('handles duplicate documents without shifting indices', async () => {
    const docs = ['same', 'same', 'other'];
    const client = mockApiClient({
      results: [
        { index: 1, score: 0.9 },
        { index: 2, score: 0.5 },
      ],
    });
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: { query: 'q', documents: docs, return_documents: true },
        },
      },
      client,
    );
    const results = (
      r as { structuredContent: { results: Array<{ index: number; document: string }> } }
    ).structuredContent.results;
    expect(results[0].document).toBe('same');
    expect(results[1].document).toBe('other');
  });

  it('returns INTERNAL when API returns an out-of-range index', async () => {
    const client = mockApiClient({
      results: [{ index: 5, score: 0.9 }],
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a', 'b'] } } },
      client,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INTERNAL');
  });

  it('works with a single document', async () => {
    const client = mockApiClient({ results: [{ index: 0, score: 1 }] });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['solo'] } } },
      client,
    );
    const sc = (r as { structuredContent: { results: Array<{ index: number }> } })
      .structuredContent;
    expect(sc.results).toHaveLength(1);
    expect(sc.results[0].index).toBe(0);
  });
});
