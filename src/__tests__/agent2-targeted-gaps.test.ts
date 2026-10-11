/**
 * Agent 2 — Targeted coverage for genuinely untested code paths.
 *
 * NOTE: Multiple agents may be editing the repo concurrently.
 * This file ONLY adds new tests in src/__tests__/ and does NOT
 * modify any source files.
 *
 * Targets (confirmed untested via exhaustive grep of all src/__tests__/):
 *
 * tool-handlers.ts (router):
 *  1. Oversized tool name (>128 chars) — safeName truncation in MethodNotFound
 *  2. Name at exactly 128 chars — boundary: NOT truncated
 *  3. Name at 129 chars — boundary: IS truncated
 *  4. Very short unknown name — no truncation
 *
 * decide.ts (response summary formatting):
 *  5. score answer with `score: null` (not undefined, not empty array) — skipped
 *  6. choice answer with `choice: null` (not undefined, not missing) — skipped
 *  7. score answer with `-Infinity` values — typeof check passes but comparison fails
 *  8. noul with `-Infinity` — typeof=number, isFinite=false → defaults to 0
 *  9. score answer with `score: "string"` (non-array truthy) — skipped
 *
 * embed-text.ts:
 * 10. Summary text includes "using <model>" phrasing check
 * 11. Multiple embeddings with different lengths — dimensions from first
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ErrorCode as McpErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { ToolHandlers } from '../tool-handlers.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

type ServerWithHandlers = Server & {
  _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<unknown>>;
};

function getToolsCallHandler(server: Server) {
  const handler = (server as ServerWithHandlers)._requestHandlers.get('tools/call');
  if (!handler) throw new Error('tools/call handler not registered');
  return handler;
}

function mockDecideClient(response: unknown) {
  const submitDecision = vi.fn().mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown) {
  const createEmbeddings = vi.fn().mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function noulQ(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

function scoreQ(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

function choiceQ(instructions = 'Pick a color') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { red: 'Color red', blue: 'Color blue', green: 'Color green' },
  };
}

// ---------------------------------------------------------------------------
// 1–4. Router — safeName truncation for oversized tool names
// ---------------------------------------------------------------------------

describe('ToolHandlers router — oversized and missing tool names', () => {
  beforeEach(() => {
    ModelCache.getInstance().setModels([{ id: 'openai/gpt-4o', name: 'GPT-4o' }]);
  });

  it('truncates tool name >128 chars in MethodNotFound error', async () => {
    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    const longName = 'x'.repeat(200);
    try {
      await call({ method: 'tools/call', params: { name: longName, arguments: {} } }, {});
      expect.unreachable('expected MethodNotFound');
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      const mcpErr = err as McpError;
      expect(mcpErr.code).toBe(McpErrorCode.MethodNotFound);
      // The full 200-char name should NOT appear in the error
      expect(mcpErr.message).not.toContain(longName);
      // Should contain truncated version (128 chars + '…')
      expect(mcpErr.message).toContain('x'.repeat(128) + '…');
    }
  });

  it('handles name at exactly 128 chars without truncation', async () => {
    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    const exactName = 'y'.repeat(128);
    try {
      await call({ method: 'tools/call', params: { name: exactName, arguments: {} } }, {});
      expect.unreachable('expected MethodNotFound');
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      const mcpErr = err as McpError;
      expect(mcpErr.code).toBe(McpErrorCode.MethodNotFound);
      // Name is exactly 128 — should NOT be truncated
      expect(mcpErr.message).toContain(exactName);
      expect(mcpErr.message).not.toContain('…');
    }
  });

  it('handles 129-char tool name with truncation', async () => {
    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    const name129 = 'z'.repeat(129);
    try {
      await call({ method: 'tools/call', params: { name: name129, arguments: {} } }, {});
      expect.unreachable('expected MethodNotFound');
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      const mcpErr = err as McpError;
      expect(mcpErr.code).toBe(McpErrorCode.MethodNotFound);
      // 129 chars > 128 → truncated with '…'
      expect(mcpErr.message).toContain('z'.repeat(128) + '…');
      expect(mcpErr.message).not.toContain(name129);
    }
  });

  it('handles very short unknown tool name without truncation', async () => {
    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    try {
      await call({ method: 'tools/call', params: { name: 'ab', arguments: {} } }, {});
      expect.unreachable('expected MethodNotFound');
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      const mcpErr = err as McpError;
      expect(mcpErr.code).toBe(McpErrorCode.MethodNotFound);
      expect(mcpErr.message).toContain('ab');
      expect(mcpErr.message).not.toContain('…');
    }
  });
});

// ---------------------------------------------------------------------------
// 5–9. Decide — response summary edge cases with explicit null/non-finite values
// ---------------------------------------------------------------------------

describe('handleDecide — response summary with null score/choice', () => {
  it('skips score answer with score: null in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: null },
        q2: { type: 'noul', noul: 0.8 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ(), q2: noulQ() } }),
      client,
    )) as SuccessResult;
    // q1 with score:null should be skipped (Array.isArray(null) is false)
    // q2 should produce a line
    const text = r.content[0].text;
    expect(text).toContain('q2');
    expect(text).toContain('YES');
    // q1 should not produce a "level" line since score is null
    expect(text).not.toContain('level');
  });

  it('skips choice answer with choice: null in summary', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: null },
        q2: { type: 'noul', noul: 0.3 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ(), q2: noulQ() } }),
      client,
    )) as SuccessResult;
    // q1 with choice:null should be skipped (answer.choice is falsy)
    // q2 should produce a line
    const text = r.content[0].text;
    expect(text).toContain('q2');
    expect(text).toContain('NO');
  });

  it('handles score answer with -Infinity values (skipped as non-number comparison)', async () => {
    // -Infinity is typeof 'number' so it passes the type check, but
    // -Infinity > -Infinity is false (equal), so maxVal stays at -Infinity
    // and displayScore falls to 0
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [-Infinity, -Infinity] },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as SuccessResult;
    // All -Infinity → maxVal stays -Infinity → displayScore=0 → 0.0%
    expect(r.content[0].text).toContain('0.0%');
    expect(r.content[0].text).toContain('level 1/2');
  });

  it('handles noul with -Infinity (typeof=number, isFinite=false → defaults to 0)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -Infinity } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    // -Infinity is a number but not finite → prob defaults to 0 → NO
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('skips score answer when score is a non-array truthy value', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: 'not-an-array' },
        q2: { type: 'noul', noul: 0.7 },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ(), q2: noulQ() } }),
      client,
    )) as SuccessResult;
    // score: "string" → Array.isArray is false → skipped
    const text = r.content[0].text;
    expect(text).toContain('q2');
    expect(text).toContain('YES');
    expect(text).not.toContain('level');
  });
});

// ---------------------------------------------------------------------------
// 10–11. Embed-text — summary text format and multi-embedding edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — summary text format details', () => {
  it('summary text includes "using <model>" phrasing', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'voyage/voyage-3',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as SuccessResult;
    expect(r.content[0].text).toContain('using voyage/voyage-3');
    expect(r.content[0].text).toMatch(/Generated 1 embedding\(s\) with 2 dimensions using/);
  });

  it('handles embeddings with different vector lengths (dimensions from first)', async () => {
    // In theory this shouldn't happen, but if the API returns embeddings with
    // different vector lengths, dimensions should come from the first one
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3] },
        { index: 1, embedding: [0.4, 0.5] }, // shorter
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as SuccessResult;
    // Dimensions should be 3 (from first embedding)
    expect(r.structuredContent.dimensions).toBe(3);
    expect(r._meta.dimensions).toBe(3);
    // Both embeddings should be in the result
    expect((r.structuredContent.embeddings as unknown[]).length).toBe(2);
  });
});
