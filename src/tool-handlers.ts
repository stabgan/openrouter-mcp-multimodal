import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import OpenAI from 'openai';
import { ModelCache } from './model-cache.js';
import { OpenRouterAPIClient } from './openrouter-api.js';
import { handleChatCompletion } from './tool-handlers/chat-completion.js';
import { handleAnalyzeImage } from './tool-handlers/analyze-image.js';
import { handleSearchModels } from './tool-handlers/search-models.js';
import { handleGetModelInfo } from './tool-handlers/get-model-info.js';
import { handleValidateModel } from './tool-handlers/validate-model.js';
import { handleGenerateImage } from './tool-handlers/generate-image.js';
import { handleAnalyzeAudio } from './tool-handlers/analyze-audio.js';
import { handleGenerateAudio } from './tool-handlers/generate-audio.js';
import type { ChatCompletionToolRequest } from './tool-handlers/chat-completion.js';
import type { AnalyzeImageToolRequest } from './tool-handlers/analyze-image.js';
import type { SearchModelsArgs } from './tool-handlers/search-models.js';
import type { GenerateImageToolRequest } from './tool-handlers/generate-image.js';
import type { AnalyzeAudioToolRequest } from './tool-handlers/analyze-audio.js';
import type { GenerateAudioToolRequest } from './tool-handlers/generate-audio.js';

function wrapToolArgs<T extends object>(a: T | undefined): { params: { arguments: T } } {
  return { params: { arguments: a ?? ({} as T) } };
}

export class ToolHandlers {
  private openai: OpenAI;
  private modelCache = ModelCache.getInstance();
  private apiClient: OpenRouterAPIClient;
  private defaultModel?: string;

  constructor(server: Server, apiKey: string, defaultModel?: string) {
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
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                    content: {
                      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }],
                    },
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
        {
          name: 'analyze_audio',
          description: 'Analyze or transcribe an audio file using a multimodal model',
          inputSchema: {
            type: 'object',
            properties: {
              audio_path: { type: 'string', description: 'File path, URL, or data URL (base64-encoded audio)' },
              question: { type: 'string', description: 'Question or instruction about the audio (default: transcribe)' },
              model: { type: 'string' },
            },
            required: ['audio_path'],
          },
        },
        {
          name: 'generate_audio',
          description: 'Generate audio from a text prompt using a (conversational) audio model (e.g., openai/gpt-audio). Available models may either be conversational or speech generation models. Use search_models to find audio-capable models. If voice is invalid, the API returns an error listing valid voices.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Text input' },
              model: { type: 'string', description: 'Model ID (default: openai/gpt-audio)' },
              voice: { type: 'string', description: 'Voice name (provider-specific). OpenAI voices: alloy, ash, ballad, coral, echo, sage, shimmer, verse. Other providers may have different voices.' },
              format: { type: 'string', description: 'Audio format: pcm16 (required for streaming), wav, mp3, flac, opus. Note: OpenAI models only support pcm16 for audio output.' },
              save_path: { type: 'string', description: 'Optional path to save audio file' },
            },
            required: ['prompt'],
          },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      switch (name) {
        case 'chat_completion':
          return handleChatCompletion(
            wrapToolArgs(args as ChatCompletionToolRequest | undefined),
            this.openai,
            this.defaultModel,
          );
        case 'analyze_image':
          return handleAnalyzeImage(
            wrapToolArgs(args as AnalyzeImageToolRequest | undefined),
            this.openai,
            this.defaultModel,
          );
        case 'search_models':
          return handleSearchModels(
            wrapToolArgs(args as SearchModelsArgs | undefined),
            this.apiClient,
            this.modelCache,
          );
        case 'get_model_info':
          return handleGetModelInfo(
            wrapToolArgs(args as { model: string } | undefined),
            this.modelCache,
            this.apiClient,
          );
        case 'validate_model':
          return handleValidateModel(
            wrapToolArgs(args as { model: string } | undefined),
            this.modelCache,
            this.apiClient,
          );
        case 'generate_image':
          return handleGenerateImage(
            wrapToolArgs(args as GenerateImageToolRequest | undefined),
            this.openai,
          );
        case 'analyze_audio':
          return handleAnalyzeAudio(
            wrapToolArgs(args as AnalyzeAudioToolRequest | undefined),
            this.openai,
            this.defaultModel,
          );
        case 'generate_audio':
          return handleGenerateAudio(
            wrapToolArgs(args as GenerateAudioToolRequest | undefined),
            this.openai,
          );
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    });
  }
}
