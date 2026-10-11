/**
 * Agent 2 — Final handler gap coverage for embed_text and decide.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Genuinely untested paths found via exhaustive grep across all 123 test files:
 *
 * decide — input type edge cases:
 *  1. questions is a number (42) → typeof !== 'object' → INVALID_INPUT
 *  2. questions is a boolean (true) → typeof !== 'object' → INVALID_INPUT
 *  3. questions is 0 (falsy number) → !0 → true → INVALID_INPUT
 *  4. questions is false → !false → true → INVALID_INPUT
 *
 * decide — response integration:
 *  5. Response usage with all 5 known keys → all preserved in _meta
 *  6. Score answer where first level is max but negative → still chosen
 *  7. Choice answer with only one valid entry after sanitization → picked
 *
 * embed_text — response integration:
 *  8. Response usage with all 5 known keys → all preserved in _meta
 *  9. Batch with 1 text, upstream returns exactly 1 embedding → no capping
 * 10. response.model with trailing spaces → preserved as-is (no trim on response)
 *
 * Router dispatch (tool-handlers-router.test.ts only covers health_check):
 * 11. embed_text dispatches through the switch correctly
 * 12. decide dispatches through the switch correctly
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { ToolHandlers } from '../tool-handlers.js';
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

// ═══════════════════════════════════════════════════════════════════════════
// 1–4. decide — questions input type edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — questions parameter type edge cases', () => {
  it('returns INVALID_INPUT when questions is a number (42)', async () => {
    const r = (await handleDecide(
      decideReq({ questions: 42 }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions is required');
    expect(r.content[0].text).toContain('must be an object');
  });

  it('returns INVALID_INPUT when questions is a boolean (true)', async () => {
    const r = (await handleDecide(
      decideReq({ questions: true }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('must be an object');
  });

  it('returns INVALID_INPUT when questions is falsy number (0)', async () => {
    // 0 is falsy → !0 === true → short-circuits at !questions check
    const r = (await handleDecide(
      decideReq({ questions: 0 }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('questions is required');
  });

  it('returns INVALID_INPUT when questions is false', async () => {
    // false is falsy → !false === true → short-circuits at !questions check
    const r = (await handleDecide(
      decideReq({ questions: false }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. decide — response usage with all 5 known keys
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — response usage with all known keys', () => {
  it('preserves all 5 known keys in _meta.usage', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.8 } },
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cost: 0.003,
        duration_s: 1.5,
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r._meta.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cost: 0.003,
      duration_s: 1.5,
    });
  });

  it('strips unknown keys from usage while preserving known ones', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
      usage: {
        prompt_tokens: 10,
        unknown_key: 'should_be_stripped',
        another_unknown: 42,
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r._meta.usage).toEqual({ prompt_tokens: 10 });
    expect((r._meta.usage as Record<string, unknown>)?.unknown_key).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. decide — score with negative values
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score with negative probabilities', () => {
  it('picks the first level as max when values are negative and first is largest', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [-0.1, -0.5, -0.9] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // -0.1 is the largest negative → level 1/3
    expect(r.content[0].text).toContain('level 1/3');
    expect(r.content[0].text).toContain('-10.0%');
    // Sanitized score in structuredContent
    expect(r.structuredContent.answers.q1?.score).toEqual([-0.1, -0.5, -0.9]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. decide — choice with one valid entry after sanitization
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice sanitization leaves single valid entry', () => {
  it('picks the single remaining valid choice in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: {
          type: 'choice',
          choice: { bad1: NaN, bad2: Infinity, good: 0.75, bad3: 'string' },
        },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Only 'good' is a finite number
    expect(r.content[0].text).toContain('good');
    expect(r.content[0].text).toContain('75.0%');
    expect(r.structuredContent.answers.q1?.choice).toEqual({ good: 0.75 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. embed_text — response usage with all 5 known keys
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response usage with all known keys', () => {
  it('preserves all 5 known keys in _meta.usage', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'openai/text-embedding-3-small',
      usage: {
        prompt_tokens: 5,
        completion_tokens: 0,
        total_tokens: 5,
        cost: 0.0001,
        duration_s: 0.25,
      },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r._meta.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 0,
      total_tokens: 5,
      cost: 0.0001,
      duration_s: 0.25,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. embed_text — exact 1-text, 1-embedding (no capping exercised)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — single text single embedding (exact match)', () => {
  it('returns exactly 1 embedding without any capping', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'single input' }),
      client,
    )) as EmbedSuccessResult;
    expect(r.structuredContent.embeddings).toHaveLength(1);
    expect(r.structuredContent.embeddings[0].index).toBe(0);
    expect(r.structuredContent.embeddings[0].embedding).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(r.structuredContent.dimensions).toBe(5);
    expect(r._meta.embedding_count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. embed_text — response model with trailing spaces preserved
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response model is not trimmed', () => {
  it('preserves trailing spaces in response.model as displayModel', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'openai/text-embedding-3-small  ', // trailing spaces
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as EmbedSuccessResult;
    // The response model is not trimmed by the handler — it checks typeof and
    // length but does NOT trim. So the trailing-space model passes both checks
    // and is used as displayModel.
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small  ');
    expect(r._meta.model).toBe('openai/text-embedding-3-small  ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11–12. Router dispatch for embed_text and decide
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('../tool-handlers/embed-text.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    handleEmbedText: vi.fn(actual.handleEmbedText as (...args: unknown[]) => unknown),
  };
});

vi.mock('../tool-handlers/decide.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    handleDecide: vi.fn(actual.handleDecide as (...args: unknown[]) => unknown),
  };
});

type ServerWithHandlers = Server & {
  _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<unknown>>;
};

function getToolsCallHandler(server: Server) {
  const handler = (server as ServerWithHandlers)._requestHandlers.get('tools/call');
  if (!handler) throw new Error('tools/call handler not registered');
  return handler;
}

describe('ToolHandlers router — embed_text dispatch', () => {
  beforeEach(() => {
    vi.mocked(handleEmbedText).mockReset();
  });

  it('dispatches embed_text through the router and returns handler result', async () => {
    vi.mocked(handleEmbedText).mockResolvedValue({
      content: [{ type: 'text', text: 'Generated 1 embedding(s)' }],
      structuredContent: {
        embeddings: [{ index: 0, embedding: [0.1] }],
        model: 'openai/text-embedding-3-small',
        dimensions: 1,
      },
      _meta: { server_version: '5.1.0', model: 'openai/text-embedding-3-small' },
    });

    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    const result = (await call(
      {
        method: 'tools/call',
        params: { name: 'embed_text', arguments: { texts: 'hello' } },
      },
      {},
    )) as EmbedSuccessResult;

    expect(handleEmbedText).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain('1 embedding(s)');
  });

  it('wraps missing arguments as empty object for embed_text', async () => {
    // handleEmbedText will return an INVALID_INPUT error because texts is
    // required — this tests that the router wraps missing args correctly.
    vi.mocked(handleEmbedText).mockResolvedValue({
      content: [{ type: 'text', text: 'texts is required' }],
      isError: true,
      _meta: { code: 'INVALID_INPUT' },
    } as unknown as Awaited<ReturnType<typeof handleEmbedText>>);

    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    const result = (await call(
      { method: 'tools/call', params: { name: 'embed_text' } },
      {},
    )) as ErrorResult;

    expect(handleEmbedText).toHaveBeenCalledWith({ params: { arguments: {} } }, expect.anything());
    expect(result.isError).toBe(true);
  });
});

describe('ToolHandlers router — decide dispatch', () => {
  beforeEach(() => {
    vi.mocked(handleDecide).mockReset();
  });

  it('dispatches decide through the router and returns handler result', async () => {
    vi.mocked(handleDecide).mockResolvedValue({
      content: [{ type: 'text', text: 'q1: YES (P=90.0%)' }],
      structuredContent: {
        answers: { q1: { type: 'noul', noul: 0.9 } },
      },
      _meta: { server_version: '5.1.0', model: 'typesafe/jev-1.13' },
    });

    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    const result = (await call(
      {
        method: 'tools/call',
        params: {
          name: 'decide',
          arguments: { questions: { q1: noulQuestion() } },
        },
      },
      {},
    )) as DecideSuccessResult;

    expect(handleDecide).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain('YES');
  });

  it('wraps missing arguments as empty object for decide', async () => {
    vi.mocked(handleDecide).mockResolvedValue({
      content: [{ type: 'text', text: 'questions is required' }],
      isError: true,
      _meta: { code: 'INVALID_INPUT' },
    } as unknown as Awaited<ReturnType<typeof handleDecide>>);

    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    const result = (await call(
      { method: 'tools/call', params: { name: 'decide' } },
      {},
    )) as ErrorResult;

    expect(handleDecide).toHaveBeenCalledWith({ params: { arguments: {} } }, expect.anything());
    expect(result.isError).toBe(true);
  });
});
