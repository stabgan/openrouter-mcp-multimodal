import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import OpenAI from 'openai';
import { ModelCache } from './model-cache.js';
import { OpenRouterAPIClient } from './openrouter-api.js';
import { handleChatCompletion } from './tool-handlers/chat-completion.js';
import { handleAnalyzeImage } from './tool-handlers/analyze-image.js';
import { handleSearchModels } from './tool-handlers/search-models.js';
import { handleGetModelInfo } from './tool-handlers/get-model-info.js';
import { handleValidateModel } from './tool-handlers/validate-model.js';
import { handleGenerateImage } from './tool-handlers/generate-image.js';

export class ToolHandlers {
  private openai: OpenAI;
  private modelCache = ModelCache.getInstance();
  private apiClient: OpenRouterAPIClient;
  private apiKey: string;
  private defaultModel?: string;

  constructor(server: Server, apiKey: string, defaultModel?: string) {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
    this.apiClient = new OpenRouterAPIClient(apiKey);
    this.openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });

    this.register(server);
  }

  private register(server: Server) {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'chat_completion',
          description: 'Send messages to an OpenRouter model and get a response',
          inputSchema: {
            type: 'object',
            properties: {
              model: { type: 'string', description: 'Model ID (optional, uses default)' },
              messages: {
                type: 'array', minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                    content: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }] },
                  },
                  required: ['role', 'content'],
                },
              },
              temperature: { type: 'number', minimum: 0, maximum: 2 },
              max_tokens: { type: 'number', minimum: 1 },
            },
            required: ['messages'],
          },
        },
        {
          name: 'analyze_image',
          description: 'Analyze an image using a vision model',
          inputSchema: {
            type: 'object',
            properties: {
              image_path: { type: 'string', description: 'File path, URL, or data URL' },
              question: { type: 'string', description: 'Question about the image' },
              model: { type: 'string' },
            },
            required: ['image_path'],
          },
        },
        {
          name: 'search_models',
          description: 'Search available OpenRouter models',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              provider: { type: 'string' },
              capabilities: { type: 'object', properties: { vision: { type: 'boolean' } } },
              limit: { type: 'number', minimum: 1, maximum: 50 },
            },
          },
        },
        {
          name: 'get_model_info',
          description: 'Get details about a specific model',
          inputSchema: {
            type: 'object',
            properties: { model: { type: 'string' } },
            required: ['model'],
          },
        },
        {
          name: 'validate_model',
          description: 'Check if a model ID exists',
          inputSchema: {
            type: 'object',
            properties: { model: { type: 'string' } },
            required: ['model'],
          },
        },
        {
          name: 'generate_image',
          description: 'Generate an image from a text prompt',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              model: { type: 'string' },
              save_path: { type: 'string' },
            },
            required: ['prompt'],
          },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const wrap = (a: any) => ({ params: { arguments: a } });

      switch (name) {
        case 'chat_completion':
          return handleChatCompletion(wrap(args), this.openai, this.defaultModel);
        case 'analyze_image':
          return handleAnalyzeImage(wrap(args), this.openai, this.defaultModel);
        case 'search_models':
          return handleSearchModels(wrap(args), this.apiClient, this.modelCache);
        case 'get_model_info':
          return handleGetModelInfo(wrap(args), this.modelCache, this.apiClient);
        case 'validate_model':
          return handleValidateModel(wrap(args), this.modelCache, this.apiClient);
        case 'generate_image':
          return handleGenerateImage(wrap(args), this.apiKey);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    });
  }
}
