#!/usr/bin/env node
// OpenRouter Multimodal MCP Server
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ToolHandlers } from './tool-handlers.js';

// Define the default model to use when none is specified
const DEFAULT_MODEL = 'qwen/qwen2.5-vl-32b-instruct:free';

interface ServerOptions {
  apiKey?: string;
  defaultModel?: string;
}

class OpenRouterMultimodalServer {
  private server: Server;
  private toolHandlers!: ToolHandlers; // Using definite assignment assertion

  constructor(options?: ServerOptions) {
    // Retrieve API key from options or environment variables
    const apiKey = options?.apiKey || process.env.OPENROUTER_API_KEY;
    const defaultModel = options?.defaultModel || process.env.OPENROUTER_DEFAULT_MODEL || DEFAULT_MODEL;

    // Check if API key is provided
    if (!apiKey) {
      throw new Error('OpenRouter API key is required. Provide it via options or OPENROUTER_API_KEY environment variable');
    }

    // Initialize the server
    this.server = new Server(
      {
        name: 'openrouter-multimodal-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    
    // Set up error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    
    // Initialize tool handlers
    this.toolHandlers = new ToolHandlers(
      this.server,
      apiKey,
      defaultModel
    );
    
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('OpenRouter Multimodal MCP server running on stdio');
    
    // Log model information
    const modelDisplay = this.toolHandlers.getDefaultModel() || DEFAULT_MODEL;
    console.error(`Using default model: ${modelDisplay}`);
    console.error('Server is ready to process tool calls. Waiting for input...');
  }
}

// Get MCP configuration if provided
let mcpOptions: ServerOptions | undefined;

// Check if we're being run as an MCP server with configuration
if (process.argv.length > 2) {
  try {
    const configArg = process.argv.find(arg => arg.startsWith('--config='));
    if (configArg) {
      const configPath = configArg.split('=')[1];
      const configData = require(configPath);
      
      // Extract configuration
      mcpOptions = {
        apiKey: configData.OPENROUTER_API_KEY || configData.apiKey,
        defaultModel: configData.OPENROUTER_DEFAULT_MODEL || configData.defaultModel
      };
      
      if (mcpOptions.apiKey) {
        console.error('Using API key from MCP configuration');
      }
    }
  } catch (error) {
    console.error('Error parsing MCP configuration:', error);
  }
}

// Note: We intentionally do NOT attempt to parse stdin for configuration here.
// The MCP SDK's StdioServerTransport expects stdin to emit binary Buffers.
// Calling process.stdin.setEncoding('utf8') or consuming messages before
// transport connection breaks the MCP protocol and causes errors like:
// "TypeError: this._buffer.subarray is not a function"
//
// Configuration should be provided via:
// - Environment variables: OPENROUTER_API_KEY, OPENROUTER_DEFAULT_MODEL
// - Config file: --config=/path/to/config.json

const server = new OpenRouterMultimodalServer(mcpOptions);
server.run().catch(console.error); 
