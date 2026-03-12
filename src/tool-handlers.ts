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

// Import tool handlers
import { handleChatCompletion, ChatCompletionToolRequest } from './tool-handlers/chat-completion.js';
import { handleSearchModels, SearchModelsToolRequest } from './tool-handlers/search-models.js';
import { handleGetModelInfo, GetModelInfoToolRequest } from './tool-handlers/get-model-info.js';
import { handleValidateModel, ValidateModelToolRequest } from './tool-handlers/validate-model.js';
import { handleMultiImageAnalysis, MultiImageAnalysisToolRequest } from './tool-handlers/multi-image-analysis.js';
import { handleAnalyzeImage, AnalyzeImageToolRequest } from './tool-handlers/analyze-image.js';
import { handleGenerateImage, GenerateImageToolRequest } from './tool-handlers/generate-image.js';

export class ToolHandlers {
  private server: Server;
  private openai: OpenAI;
  private modelCache: ModelCache;
  private apiClient: OpenRouterAPIClient;
  private apiKey: string;
  private defaultModel?: string;

  constructor(
    server: Server, 
    apiKey: string, 
    defaultModel?: string
  ) {
    this.server = server;
    this.modelCache = ModelCache.getInstance();
    this.apiClient = new OpenRouterAPIClient(apiKey);
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;

    this.openai = new OpenAI({
      apiKey: apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/stabgan/openrouter-mcp-multimodal',
        'X-Title': 'OpenRouter MCP Multimodal Server',
      },
    });

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Chat Completion Tool
        {
          name: 'mcp_openrouter_chat_completion',
          description: 'Send a message to OpenRouter.ai and get a response',
          inputSchema: {
            type: 'object',
            properties: {
              model: {
                type: 'string',
                description: 'The model to use (e.g., "google/gemini-2.5-pro-exp-03-25:free", "undi95/toppy-m-7b:free"). If not provided, uses the default model if set.',
              },
              messages: {
                type: 'array',
                description: 'An array of conversation messages with roles and content',
                minItems: 1,
                maxItems: 100,
                items: {
                  type: 'object',
                  properties: {
                    role: {
                      type: 'string',
                      enum: ['system', 'user', 'assistant'],
                      description: 'The role of the message sender',
                    },
                    content: {
                      oneOf: [
                        {
                          type: 'string',
                          description: 'The text content of the message',
                        },
                        {
                          type: 'array',
                          description: 'Array of content parts for multimodal messages (text and images)',
                          items: {
                            type: 'object',
                            properties: {
                              type: {
                                type: 'string',
                                enum: ['text', 'image_url'],
                                description: 'The type of content (text or image)',
                              },
                              text: {
                                type: 'string',
                                description: 'The text content (for text type)',
                              },
                              image_url: {
                                type: 'object',
                                description: 'The image URL object (for image_url type)',
                                properties: {
                                  url: {
                                    type: 'string',
                                    description: 'URL of the image (can be a data URL with base64)',
                                  },
                                },
                                required: ['url'],
                              },
                            },
                            required: ['type'],
                          },
                        },
                      ],
                    },
                  },
                  required: ['role', 'content'],
                },
              },
              temperature: {
                type: 'number',
                description: 'Sampling temperature (0-2)',
                minimum: 0,
                maximum: 2,
              },
              max_tokens: {
                type: 'number',
                description: 'Maximum number of tokens to generate in the response. Use this to ensure the model completes long outputs.',
                minimum: 1,
              },
            },
            required: ['messages'],
          },
          maxContextTokens: 200000
        },
        
        // Single Image Analysis Tool
        {
          name: 'mcp_openrouter_analyze_image',
          description: 'Analyze an image using OpenRouter vision models',
          inputSchema: {
            type: 'object',
            properties: {
              image_path: {
                type: 'string',
                description: 'Path to the image file to analyze (can be an absolute file path, URL, or base64 data URL starting with "data:")',
              },
              question: {
                type: 'string',
                description: 'Question to ask about the image',
              },
              model: {
                type: 'string',
                description: 'OpenRouter model to use (e.g., "anthropic/claude-3.5-sonnet")',
              },
            },
            required: ['image_path'],
          },
        },
        
        // Multi-Image Analysis Tool
        {
          name: 'mcp_openrouter_multi_image_analysis',
          description: 'Analyze multiple images at once with a single prompt and receive detailed responses',
          inputSchema: {
            type: 'object',
            properties: {
              images: {
                type: 'array',
                description: 'Array of image objects to analyze',
                items: {
                  type: 'object',
                  properties: {
                    url: {
                      type: 'string',
                      description: 'URL or data URL of the image (use http(s):// for web images, absolute file paths for local files, or data:image/xxx;base64,... for base64 encoded images)',
                    },
                    alt: {
                      type: 'string',
                      description: 'Optional alt text or description of the image',
                    },
                  },
                  required: ['url'],
                },
              },
              prompt: {
                type: 'string',
                description: 'Prompt for analyzing the images',
              },
              markdown_response: {
                type: 'boolean',
                description: 'Whether to format the response in Markdown (default: true)',
                default: true,
              },
              model: {
                type: 'string',
                description: 'OpenRouter model to use. If not specified, the system will use a free model with vision capabilities or the default model.',
              },
            },
            required: ['images', 'prompt'],
          },
        },
        
        // Search Models Tool
        {
          name: 'search_models',
          description: 'Search and filter OpenRouter.ai models based on various criteria',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Optional search query to filter by name, description, or provider',
              },
              provider: {
                type: 'string',
                description: 'Filter by specific provider (e.g., "anthropic", "openai", "cohere")',
              },
              minContextLength: {
                type: 'number',
                description: 'Minimum context length in tokens',
              },
              maxContextLength: {
                type: 'number',
                description: 'Maximum context length in tokens',
              },
              maxPromptPrice: {
                type: 'number',
                description: 'Maximum price per 1K tokens for prompts',
              },
              maxCompletionPrice: {
                type: 'number',
                description: 'Maximum price per 1K tokens for completions',
              },
              capabilities: {
                type: 'object',
                description: 'Filter by model capabilities',
                properties: {
                  functions: {
                    type: 'boolean',
                    description: 'Requires function calling capability',
                  },
                  tools: {
                    type: 'boolean',
                    description: 'Requires tools capability',
                  },
                  vision: {
                    type: 'boolean',
                    description: 'Requires vision capability',
                  },
                  json_mode: {
                    type: 'boolean',
                    description: 'Requires JSON mode capability',
                  }
                }
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 10)',
                minimum: 1,
                maximum: 50
              }
            }
          },
        },
        
        // Get Model Info Tool
        {
          name: 'get_model_info',
          description: 'Get detailed information about a specific model',
          inputSchema: {
            type: 'object',
            properties: {
              model: {
                type: 'string',
                description: 'The model ID to get information for',
              },
            },
            required: ['model'],
          },
        },
        
        // Validate Model Tool
        {
          name: 'validate_model',
          description: 'Check if a model ID is valid',
          inputSchema: {
            type: 'object',
            properties: {
              model: {
                type: 'string',
                description: 'The model ID to validate',
              },
            },
            required: ['model'],
          },
        },
        
        // Generate Image Tool
        {
          name: 'generate_image',
          description: 'Generate an image using OpenRouter image generation models (e.g., Nano Banana / Gemini 2.5 Flash Image). Returns the generated image as base64 data. Optionally saves to disk.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The prompt describing the image to generate. Be descriptive about style, colors, composition, etc.',
              },
              model: {
                type: 'string',
                description: 'The image generation model to use. Defaults to "google/gemini-2.5-flash-image" (Nano Banana). Other options: "google/gemini-3-pro-image-preview" (Nano Banana Pro).',
              },
              save_path: {
                type: 'string',
                description: 'Optional absolute file path to save the generated image. Directory will be created if it does not exist. Example: "/path/to/image.png"',
              },
            },
            required: ['prompt'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'mcp_openrouter_chat_completion':
          return handleChatCompletion({
            params: {
              arguments: request.params.arguments as unknown as ChatCompletionToolRequest
            }
          }, this.openai, this.defaultModel);
        
        case 'mcp_openrouter_analyze_image':
          return handleAnalyzeImage({
            params: {
              arguments: request.params.arguments as unknown as AnalyzeImageToolRequest
            }
          }, this.openai, this.defaultModel);
          
        case 'mcp_openrouter_multi_image_analysis':
          return handleMultiImageAnalysis({
            params: {
              arguments: request.params.arguments as unknown as MultiImageAnalysisToolRequest
            }
          }, this.openai, this.defaultModel);
        
        case 'search_models':
          return handleSearchModels({
            params: {
              arguments: request.params.arguments as SearchModelsToolRequest
            }
          }, this.apiClient, this.modelCache);
        
        case 'get_model_info':
          return handleGetModelInfo({
            params: {
              arguments: request.params.arguments as unknown as GetModelInfoToolRequest
            }
          }, this.modelCache);
        
        case 'validate_model':
          return handleValidateModel({
            params: {
              arguments: request.params.arguments as unknown as ValidateModelToolRequest
            }
          }, this.modelCache);
        
        case 'generate_image':
          return handleGenerateImage({
            params: {
              arguments: request.params.arguments as unknown as GenerateImageToolRequest
            }
          }, this.apiKey);
        
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  /**
   * Get the default model configured for this server
   */
  getDefaultModel(): string | undefined {
    return this.defaultModel;
  }
}
