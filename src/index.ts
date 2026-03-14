#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ToolHandlers } from './tool-handlers.js';

const DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

// Exit on fatal errors to prevent silent zombie processes (issue #5)
process.on('uncaughtException', (err) => { console.error('[Fatal]', err); process.exit(1); });
process.on('unhandledRejection', (err) => { console.error('[Fatal]', err); process.exit(1); });

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is required');
  process.exit(1);
}

const defaultModel = process.env.OPENROUTER_DEFAULT_MODEL || DEFAULT_MODEL;

const server = new Server(
  { name: 'openrouter-multimodal-server', version: '1.6.2' },
  { capabilities: { tools: {} } }
);

server.onerror = (error) => console.error('[MCP Error]', error);

new ToolHandlers(server, apiKey, defaultModel);

process.on('SIGINT', async () => { await server.close(); process.exit(0); });

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error(`OpenRouter MCP server running (model: ${defaultModel})`);
}).catch((err) => {
  console.error('[Fatal] Server failed to start:', err);
  process.exit(1);
});
