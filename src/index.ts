#!/usr/bin/env node
import { Readable } from 'node:stream';
import { config } from 'dotenv';

config({ quiet: true }); // Load .env file if present (quiet — stdio transport owns stdout)
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ToolHandlers } from './tool-handlers.js';
import { logger } from './logger.js';
import { SERVER_VERSION } from './version.js';
import { SERVER_ICON } from './tool-icons.js';

const DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

// Log whitelisted fields only — avoid leaking auth headers from SDK errors.
function logFatal(kind: string, err: unknown): void {
  const e = err as { message?: string; name?: string; stack?: string } | null;
  logger.error('fatal', {
    kind,
    name: e?.name ?? 'unknown',
    msg: e?.message ?? String(err),
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
  {
    name: 'openrouter-multimodal-server',
    version: SERVER_VERSION,
    title: 'OpenRouter MCP Multimodal',
    description:
      'MCP server for OpenRouter — chat with 300+ LLMs, analyze/generate images, audio, and video.',
    websiteUrl: 'https://github.com/stabgan/openrouter-mcp-multimodal',
    icons: SERVER_ICON,
  },
  { capabilities: { tools: {} } },
);

server.onerror = (error) => logFatal('mcpError', error);

new ToolHandlers(server, apiKey, defaultModel);

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

// Stdin may arrive as strings on some MCP hosts; re-wrap as raw Buffers for the SDK.
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
