#!/usr/bin/env node
import { Readable } from 'node:stream';
import { config } from 'dotenv';

config(); // Load .env file if present
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ToolHandlers } from './tool-handlers.js';
import { logger } from './logger.js';
import { SERVER_VERSION } from './version.js';

const DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

// Exit on fatal errors to prevent silent zombie processes (issue #5).
// We log an explicit whitelist of fields rather than the raw error object
// to avoid ever echoing sensitive SDK internals (request bodies, auth
// headers) in a future version. Defense-in-depth against a changed
// APIError.toString() in openai-node.
function logFatal(kind: string, err: unknown): void {
  const e = err as { message?: string; name?: string; stack?: string } | null;
  logger.error('fatal', {
    kind,
    name: e?.name ?? 'unknown',
    msg: e?.message ?? String(err),
    // Stack traces are developer-only — trim to avoid unbounded log lines.
    stack: e?.stack?.split('\n').slice(0, 10).join('\n'),
  });
}
process.on('uncaughtException', (err) => {
  logFatal('uncaughtException', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  logFatal('unhandledRejection', err);
  process.exit(1);
});

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is required');
  process.exit(1);
}

const defaultModel =
  process.env.OPENROUTER_DEFAULT_MODEL || process.env.DEFAULT_MODEL || DEFAULT_MODEL;

const server = new Server(
  { name: 'openrouter-multimodal-server', version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.onerror = (error) => logFatal('mcpError', error);

new ToolHandlers(server, apiKey, defaultModel);

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

// Ensure stdin emits raw Buffers — some hosts (e.g. Claude Desktop) may set
// encoding on the stdin pipe, which causes the MCP SDK's ReadBuffer to receive
// strings instead of Buffers. ReadBuffer.readMessage() calls subarray() which
// doesn't exist on strings, triggering an infinite error loop.
const stdinStream = process.stdin as NodeJS.ReadStream & {
  setEncoding?(encoding?: BufferEncoding | null): NodeJS.ReadStream;
};
stdinStream.setEncoding?.(undefined as unknown as BufferEncoding);

const safeStdin = new Readable({
  read() {},
});
process.stdin.on('data', (chunk: Buffer | string) => {
  safeStdin.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
});
process.stdin.on('end', () => safeStdin.push(null));
process.stdin.on('error', (err) => safeStdin.destroy(err));

const transport = new StdioServerTransport(safeStdin, process.stdout);
server
  .connect(transport)
  .then(() => {
    console.error(`OpenRouter MCP server running (model: ${defaultModel})`);
  })
  .catch((err) => {
    console.error('[Fatal] Server failed to start:', err);
    process.exit(1);
  });
