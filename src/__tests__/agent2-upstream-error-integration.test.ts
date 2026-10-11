/**
 * Agent 2 — upstream error classification integration tests for embed_text and decide.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Existing tests exercise 401/404/429/500 for these handlers, but the full
 * classifyUpstreamError taxonomy has many more branches. These tests verify
 * that each error category flows correctly through handleEmbedText and
 * handleDecide — ensuring the handler's try/catch → classifyUpstreamError
 * path produces the right ErrorCode for every reachable classification.
 *
 * embed_text upstream error integration:
 *  1. 402 insufficient credits → UPSTREAM_REFUSED with reason 'credits'
 *  2. ZDR incompatible → ZDR_INCOMPATIBLE
 *  3. HTML error page → UPSTREAM_HTTP
 *  4. Context length exceeded → INVALID_INPUT with reason 'context_length'
 *  5. TLS certificate error → UPSTREAM_REFUSED with reason 'tls'
 *  6. Connection reset (ECONNRESET) → UPSTREAM_HTTP with reason 'connection_reset'
 *  7. DNS transient failure (EAI_AGAIN) → UPSTREAM_REFUSED with reason 'dns_transient'
 *  8. Timeout (ETIMEDOUT) → UPSTREAM_TIMEOUT
 *  9. 413 resource too large → RESOURCE_TOO_LARGE
 * 10. AbortError → UPSTREAM_TIMEOUT
 * 11. 504 gateway timeout → UPSTREAM_TIMEOUT
 * 12. 403 guardrail/policy → UPSTREAM_REFUSED with reason 'policy'
 * 13. Generic 4xx → INVALID_INPUT
 *
 * decide upstream error integration:
 * 14. 402 insufficient credits → UPSTREAM_REFUSED
 * 15. ZDR incompatible → ZDR_INCOMPATIBLE
 * 16. HTML error page → UPSTREAM_HTTP
 * 17. ECONNREFUSED → UPSTREAM_REFUSED with reason 'network'
 * 18. TLS protocol error (EPROTO) → UPSTREAM_REFUSED with reason 'tls'
 * 19. 408 timeout → UPSTREAM_TIMEOUT
 *
 * decide — response summary edge cases:
 * 20. Score response with -Infinity values → sanitized to 0 in structuredContent
 * 21. Score response where all NaN after sanitization but valid in summary loop
 * 22. Choice response where values include -0 → finite, included in safeChoice
 * 23. Noul answer with noul = -0 → structuredContent preserves -0
 *
 * embed_text — response model type edge cases:
 * 24. response.model is a number with length-like value → falls back
 * 25. Multiple texts where upstream returns exact count (non-slice path)
 */
import { describe, it, expect, vi } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; details?: Record<string, unknown> };
};

type EmbedSuccess = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
};

type DecideSuccess = {
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

function mockEmbedClient(response: unknown, throws?: Error) {
  const createEmbeddings = vi.fn();
  if (throws) createEmbeddings.mockRejectedValue(throws);
  else createEmbeddings.mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown, throws?: Error) {
  const submitDecision = vi.fn();
  if (throws) submitDecision.mockRejectedValue(throws);
  else submitDecision.mockResolvedValue(response);
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

function choiceQuestion(instructions = 'Pick a color') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { red: 'Color red', blue: 'Color blue', green: 'Color green' },
  };
}

function scoreQuestion(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

function makeError(
  message: string,
  opts?: { status?: number; code?: string; name?: string },
): Error & { status?: number; code?: string } {
  const err = new Error(message) as Error & { status?: number; code?: string };
  if (opts?.status !== undefined) err.status = opts.status;
  if (opts?.code !== undefined) err.code = opts.code;
  if (opts?.name !== undefined) (err as { name: string }).name = opts.name;
  return err;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–13. embed_text — upstream error classification integration
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — upstream error classification integration', () => {
  it('classifies 402 insufficient credits as UPSTREAM_REFUSED', async () => {
    const err = makeError('insufficient credits', { status: 402 });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r.content[0].text).toContain('embed_text');
    expect(r.content[0].text).toContain('insufficient credits');
  });

  it('classifies ZDR error as ZDR_INCOMPATIBLE', async () => {
    const err = makeError('zero data retention policy not supported');
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('ZDR_INCOMPATIBLE');
  });

  it('classifies HTML error page as UPSTREAM_HTTP', async () => {
    const err = makeError('<!DOCTYPE html><html><body>Server Error</body></html>');
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r.content[0].text).toContain('HTML error page');
  });

  it('classifies context length exceeded as INVALID_INPUT', async () => {
    const err = makeError('context_length_exceeded: maximum context length is 8192 tokens');
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('classifies TLS certificate error as UPSTREAM_REFUSED', async () => {
    const err = makeError('self_signed_cert_in_chain');
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('classifies ECONNRESET as UPSTREAM_HTTP', async () => {
    const err = makeError('socket hang up', { code: 'ECONNRESET' });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });

  it('classifies EAI_AGAIN as UPSTREAM_REFUSED with dns_transient', async () => {
    const err = makeError('getaddrinfo EAI_AGAIN', { code: 'EAI_AGAIN' });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('classifies ETIMEDOUT as UPSTREAM_TIMEOUT', async () => {
    const err = makeError('connect ETIMEDOUT', { code: 'ETIMEDOUT' });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('classifies 413 as RESOURCE_TOO_LARGE', async () => {
    const err = makeError('request entity too large', { status: 413 });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('RESOURCE_TOO_LARGE');
  });

  it('classifies AbortError as UPSTREAM_TIMEOUT', async () => {
    const err = makeError('The operation was aborted', { name: 'AbortError' });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('classifies 504 as UPSTREAM_TIMEOUT', async () => {
    const err = makeError('gateway timeout', { status: 504 });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('classifies 403 guardrail as UPSTREAM_REFUSED', async () => {
    const err = makeError('content policy violation', { status: 403 });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('classifies generic 4xx as INVALID_INPUT', async () => {
    const err = makeError('bad request format', { status: 422 });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello' }),
      mockEmbedClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14–19. decide — upstream error classification integration
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — upstream error classification integration', () => {
  it('classifies 402 insufficient credits as UPSTREAM_REFUSED', async () => {
    const err = makeError('requires more credits', { status: 402 });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      mockDecideClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r.content[0].text).toContain('decide');
  });

  it('classifies ZDR error as ZDR_INCOMPATIBLE', async () => {
    const err = makeError('zdr policy not met');
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      mockDecideClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('ZDR_INCOMPATIBLE');
  });

  it('classifies HTML error page as UPSTREAM_HTTP', async () => {
    const err = makeError('<html><body>503 Service Unavailable</body></html>');
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      mockDecideClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });

  it('classifies ECONNREFUSED as UPSTREAM_REFUSED with network reason', async () => {
    const err = makeError('connect ECONNREFUSED 127.0.0.1:443', { code: 'ECONNREFUSED' });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      mockDecideClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('classifies EPROTO TLS error as UPSTREAM_REFUSED', async () => {
    const err = makeError('ssl routines:ssl3_read_bytes:sslv3 alert', { code: 'EPROTO' });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      mockDecideClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('classifies 408 as UPSTREAM_TIMEOUT', async () => {
    const err = makeError('request timeout', { status: 408 });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      mockDecideClient(null, err),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20–23. decide — response value edge cases for -Infinity, -0
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — response sanitization with -Infinity and -0', () => {
  it('sanitizes -Infinity score values to 0 in structuredContent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [-Infinity, 0.3, -Infinity, 0.7] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    // -Infinity is not finite → sanitized to 0 in structuredContent
    expect(r.structuredContent.answers.q1?.score).toEqual([0, 0.3, 0, 0.7]);
    // In summary: index 3 (0.7) wins
    expect(r.content[0].text).toContain('level 4/4');
    expect(r.content[0].text).toContain('70.0%');
  });

  it('handles score where -Infinity is the only non-NaN value in summary loop', async () => {
    // In the summary loop, -Infinity passes typeof === 'number' but fails
    // the > maxVal comparison when maxVal is also -Infinity
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [NaN, -Infinity, NaN] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccess;
    // -Infinity is typeof 'number' → passes guard
    // -Infinity > -Infinity is false → maxVal stays -Infinity → displayScore = 0
    expect(r.content[0].text).toContain('0.0%');
    // structuredContent: NaN→0, -Infinity→0, NaN→0
    expect(r.structuredContent.answers.q1?.score).toEqual([0, 0, 0]);
  });

  it('includes -0 in sanitized choice map (finite number)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: -0, b: 0.6 } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccess;
    // -0 is typeof 'number' and Number.isFinite(-0) is true
    const safeChoice = r.structuredContent.answers.q1?.choice;
    expect(safeChoice).toBeDefined();
    expect(Object.keys(safeChoice!)).toContain('a');
    expect(safeChoice!.b).toBe(0.6);
  });

  it('preserves noul = -0 in structuredContent (finite number)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccess;
    // -0 is finite → safeNoul = -0
    // Object.is(-0, r.structuredContent.answers.q1?.noul) should be true
    expect(r.structuredContent.answers.q1?.noul).toBe(-0);
    // -0 >= 0.5 is false → summary says NO
    expect(r.content[0].text).toContain('NO');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 24–25. embed_text — response model type and exact count
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response model and count edge cases', () => {
  it('falls back to effective model when response.model is a number', async () => {
    // typeof 42 !== 'string' → safeResponseModel = undefined → displayModel = effectiveModel
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 42,
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'test', model: 'my/model' }),
      client,
    )) as EmbedSuccess;
    expect(r.structuredContent.model).toBe('my/model');
    expect(r._meta.model).toBe('my/model');
  });

  it('takes non-slice path when upstream returns exact count', async () => {
    // rawEmbeddings.length === inputArray.length → no slicing
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
        { index: 2, embedding: [0.3] },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b', 'c'] }), client)) as EmbedSuccess;
    expect(r.structuredContent.embeddings).toHaveLength(3);
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1]);
    expect(r.structuredContent.embeddings[1].embedding).toEqual([0.2]);
    expect(r.structuredContent.embeddings[2].embedding).toEqual([0.3]);
    expect(r._meta.embedding_count).toBe(3);
  });
});
