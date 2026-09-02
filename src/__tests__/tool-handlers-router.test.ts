import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolResultSchema,
  ErrorCode as McpErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolHandlers } from '../tool-handlers.js';
import { handleHealthCheck } from '../tool-handlers/health-check.js';
import { ModelCache } from '../model-cache.js';

vi.mock('../tool-handlers/health-check.js', () => ({
  handleHealthCheck: vi.fn(),
}));

type ServerWithHandlers = Server & {
  _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<unknown>>;
};

function getToolsCallHandler(server: Server) {
  const handler = (server as ServerWithHandlers)._requestHandlers.get('tools/call');
  if (!handler) throw new Error('tools/call handler not registered');
  return handler;
}

describe('ToolHandlers router', () => {
  beforeEach(() => {
    vi.mocked(handleHealthCheck).mockReset();
    ModelCache.getInstance().setModels([{ id: 'openai/gpt-4o', name: 'GPT-4o' }]);
  });

  it('throws MethodNotFound for unknown tool names', async () => {
    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    await expect(
      call({ method: 'tools/call', params: { name: 'not_a_real_tool', arguments: {} } }, {}),
    ).rejects.toMatchObject({
      code: McpErrorCode.MethodNotFound,
      message: expect.stringContaining('not_a_real_tool'),
    });
  });

  it('defaults missing arguments to an empty object', async () => {
    vi.mocked(handleHealthCheck).mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { ok: true },
      _meta: {},
    });

    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    await call({ method: 'tools/call', params: { name: 'health_check' } }, {});

    expect(handleHealthCheck).toHaveBeenCalledWith(
      { params: { arguments: {} } },
      expect.anything(),
      expect.anything(),
    );
  });

  it('returns a structured tool error when a handler throws', async () => {
    vi.mocked(handleHealthCheck).mockRejectedValue(new Error('boom'));

    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    const result = await call(
      { method: 'tools/call', params: { name: 'health_check', arguments: {} } },
      {},
    );

    expect(CallToolResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'boom' }],
      _meta: { code: 'INTERNAL' },
    });
  });

  it('re-throws McpError from the router itself', async () => {
    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    try {
      await call({ method: 'tools/call', params: { name: 'missing_tool', arguments: {} } }, {});
      expect.unreachable('expected MethodNotFound');
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
    }
  });

  it('returns handler results that validate against CallToolResultSchema', async () => {
    vi.mocked(handleHealthCheck).mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { ok: true },
      _meta: { server_version: '4.7.0' },
    });

    const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    new ToolHandlers(server, 'sk-test', 'openai/gpt-4o');
    const call = getToolsCallHandler(server);

    const result = await call(
      { method: 'tools/call', params: { name: 'health_check', arguments: {} } },
      {},
    );

    expect(CallToolResultSchema.safeParse(result).success).toBe(true);
  });
});
