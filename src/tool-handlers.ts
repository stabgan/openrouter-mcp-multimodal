import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode as McpErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
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
import { handleAnalyzeVideo } from './tool-handlers/analyze-video.js';
import {
  handleGenerateVideo,
  handleGetVideoStatus,
  handleGenerateVideoFromImage,
} from './tool-handlers/generate-video.js';
import { handleRerankDocuments } from './tool-handlers/rerank.js';
import { handleHealthCheck } from './tool-handlers/health-check.js';
import type { ChatCompletionToolRequest } from './tool-handlers/chat-completion.js';
import type { AnalyzeImageToolRequest } from './tool-handlers/analyze-image.js';
import type { SearchModelsArgs } from './tool-handlers/search-models.js';
import type { GenerateImageToolRequest } from './tool-handlers/generate-image.js';
import type { AnalyzeAudioToolRequest } from './tool-handlers/analyze-audio.js';
import type { GenerateAudioToolRequest } from './tool-handlers/generate-audio.js';
import type { AnalyzeVideoToolRequest } from './tool-handlers/analyze-video.js';
import type {
  GenerateVideoToolRequest,
  GetVideoStatusToolRequest,
  GenerateVideoFromImageRequest,
} from './tool-handlers/generate-video.js';
import type { RerankDocumentsRequest } from './tool-handlers/rerank.js';
import { TOOL_DESCRIPTIONS } from './tool-descriptions.js';

function wrapToolArgs<T extends object>(a: T | undefined): { params: { arguments: T } } {
  return { params: { arguments: a ?? ({} as T) } };
}

/**
 * Optional hook fired on every poll tick of a video job. When the MCP
 * client passed a `progressToken` in the request `_meta`, we wire it to
 * `server.notification('notifications/progress', ...)` so the client
 * can stream progress to its user.
 */
type McpProgressHook = (update: {
  status: string;
  progress?: number;
  attempt: number;
  video_id: string;
}) => void;

function buildProgressHook(
  server: Server,
  progressToken: string | number | undefined,
): McpProgressHook | undefined {
  if (progressToken === undefined) return undefined;
  // MCP `notifications/progress` REQUIRES `progress` to be strictly
  // monotonically increasing within a single progressToken. OpenRouter
  // returns `progress: 0..100` on some ticks and omits it on others, so
  // we anchor on a per-hook attempt counter and use the upstream number
  // only as an informational `message`. This guarantees monotonicity
  // regardless of what the upstream does (drops, duplicates, decreases).
  //
  // See MCP spec 2025-06-18 utilities/progress §Behavior Requirements:
  // "The progress value MUST increase with each notification, even if
  // the total is unknown."
  let lastSent = -1;
  return ({ status, progress, attempt, video_id }) => {
    // Always monotonic: at least attempt+1 (so initial attempt=0 → 0 stays
    // reserved for the 'submitted' ping). If upstream has a real numeric
    // progress that's higher than our counter, adopt that.
    const candidate = typeof progress === 'number' ? Math.max(attempt, progress) : attempt;
    const next = Math.max(lastSent + 1, candidate);
    lastSent = next;
    void server.notification({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress: next,
        message: `video ${video_id} — ${status}${
          typeof progress === 'number' ? ` (${progress}%)` : ''
        }`,
      },
    });
  };
}

function extractProgressToken(req: unknown): string | number | undefined {
  const meta = (req as { params?: { _meta?: { progressToken?: string | number } } })?.params?._meta;
  return meta?.progressToken;
}

export class ToolHandlers {
  private openai: OpenAI;
  private modelCache = ModelCache.getInstance();
  private apiClient: OpenRouterAPIClient;
  private defaultModel?: string;
  private server: Server;

  constructor(server: Server, apiKey: string, defaultModel?: string) {
    this.defaultModel = defaultModel;
    this.apiClient = new OpenRouterAPIClient(apiKey);
    this.openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    this.server = server;

    this.register(server);
  }

  private register(server: Server) {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'chat_completion',
          description: TOOL_DESCRIPTIONS.chat_completion,
          annotations: {
            title: 'Chat completion',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              model: {
                type: 'string',
                description:
                  'Model ID (optional, uses default). Append `:nitro` for the fastest variant, ' +
                  '`:floor` for the cheapest, or `:exacto` for the best tool-calling accuracy. ' +
                  'Example: `openai/gpt-4o:nitro`.',
              },
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
              max_tokens: {
                type: 'number',
                minimum: 1,
                description:
                  'Max completion tokens. Falls back to `OPENROUTER_MAX_TOKENS` env var if unset.',
              },
              provider: {
                type: 'object',
                description:
                  'OpenRouter provider-routing overrides. Merges on top of `OPENROUTER_PROVIDER_*` env defaults. ' +
                  'See https://openrouter.ai/docs/features/provider-routing',
                properties: {
                  quantizations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Filter providers by quantization (e.g. `["fp16","int8"]`).',
                  },
                  ignore: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Exclude these provider slugs.',
                  },
                  sort: {
                    type: 'string',
                    enum: ['price', 'throughput', 'latency'],
                  },
                  order: { type: 'array', items: { type: 'string' } },
                  require_parameters: { type: 'boolean' },
                  data_collection: { type: 'string', enum: ['allow', 'deny'] },
                  allow_fallbacks: { type: 'boolean' },
                },
              },
              include_reasoning: {
                type: 'boolean',
                description:
                  "Surface the model's chain-of-thought on `_meta.reasoning` for R1 / Opus 4.7 / Gemini Thinking.",
              },
              online: {
                type: 'boolean',
                description:
                  "Enable OpenRouter's web-search plugin (Exa-backed, $4 / 1000 results).",
              },
              web_max_results: {
                type: 'number',
                minimum: 1,
                description: 'Max web-search results when `online: true` (default 5).',
              },
              cache: {
                type: 'boolean',
                description:
                  'Enable OpenRouter response caching via `X-OpenRouter-Cache: true`. ' +
                  'Server-wide default settable via `OPENROUTER_CACHE_RESPONSES=1`.',
              },
              cache_ttl: {
                type: 'string',
                description: 'Cache TTL (e.g. `"5m"`, `"1h"`, `"24h"`; 1s-24h range).',
              },
              cache_clear: {
                type: 'boolean',
                description: 'Bust the cache entry for this exact request.',
              },
            },
            required: ['messages'],
          },
        },
        {
          name: 'analyze_image',
          description: TOOL_DESCRIPTIONS.analyze_image,
          annotations: {
            title: 'Analyze image',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              image_path: {
                type: 'string',
                description:
                  'Required. Local path (inside OPENROUTER_INPUT_DIR sandbox), https URL, or data URL. ' +
                  'Good: `"photo.jpg"`. Bad: `"url": "..."` (wrong key), `"/etc/passwd"` (UNSAFE_PATH).',
              },
              question: {
                type: 'string',
                description:
                  'Optional question about the image. Defaults to "What\'s in this image?" if omitted. ' +
                  'Good: `"List all text"`. Bad: using `prompt` key (wrong name for this tool).',
              },
              model: { type: 'string' },
              cache_input: {
                type: 'boolean',
                description:
                  'Attach `cache_control: ephemeral` to the image block so Anthropic / Gemini prompt-cache it. ' +
                  'Repeat questions about the same image save ~10x on Anthropic.',
              },
              cache: { type: 'boolean' },
              cache_ttl: { type: 'string' },
              cache_clear: { type: 'boolean' },
            },
            required: ['image_path'],
          },
        },
        {
          name: 'analyze_audio',
          description: TOOL_DESCRIPTIONS.analyze_audio,
          annotations: {
            title: 'Analyze audio',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              audio_path: {
                type: 'string',
                description:
                  'Local file path (sandboxed to OPENROUTER_INPUT_DIR / OPENROUTER_OUTPUT_DIR / cwd), ' +
                  'http(s) URL, or data URL (base64-encoded audio)',
              },
              question: {
                type: 'string',
                description: 'Question or instruction about the audio (default: transcribe)',
              },
              model: { type: 'string' },
              cache_input: { type: 'boolean' },
              cache: { type: 'boolean' },
              cache_ttl: { type: 'string' },
              cache_clear: { type: 'boolean' },
            },
            required: ['audio_path'],
          },
        },
        {
          name: 'analyze_video',
          description: TOOL_DESCRIPTIONS.analyze_video,
          annotations: {
            title: 'Analyze video',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              video_path: {
                type: 'string',
                description:
                  'Local file path (sandboxed to OPENROUTER_INPUT_DIR / OPENROUTER_OUTPUT_DIR / cwd), ' +
                  'http(s) URL, or base64 data URL. Supported: mp4 / mpeg / mov / webm.',
              },
              question: { type: 'string' },
              model: { type: 'string' },
              cache_input: { type: 'boolean' },
              cache: { type: 'boolean' },
              cache_ttl: { type: 'string' },
              cache_clear: { type: 'boolean' },
            },
            required: ['video_path'],
          },
        },
        {
          name: 'search_models',
          description: TOOL_DESCRIPTIONS.search_models,
          annotations: {
            title: 'Search models',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              provider: { type: 'string' },
              capabilities: {
                type: 'object',
                properties: {
                  vision: { type: 'boolean' },
                  audio: { type: 'boolean' },
                  video: { type: 'boolean' },
                },
              },
              limit: { type: 'number', minimum: 1, maximum: 50 },
              offset: { type: 'number', minimum: 0 },
            },
          },
          outputSchema: {
            type: 'object',
            properties: {
              results: { type: 'array', items: { type: 'object' } },
              offset: { type: 'number' },
              limit: { type: 'number' },
              total: { type: 'number' },
              has_more: { type: 'boolean' },
              next_offset: { type: ['number', 'null'] },
            },
            required: ['results', 'offset', 'limit', 'total', 'has_more', 'next_offset'],
          },
        },
        {
          name: 'get_model_info',
          description: TOOL_DESCRIPTIONS.get_model_info,
          annotations: {
            title: 'Get model info',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: { model: { type: 'string' } },
            required: ['model'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              context_length: { type: 'number' },
              architecture: { type: 'object' },
            },
            required: ['id'],
          },
        },
        {
          name: 'validate_model',
          description: TOOL_DESCRIPTIONS.validate_model,
          annotations: {
            title: 'Validate model',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: { model: { type: 'string' } },
            required: ['model'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              valid: { type: 'boolean' },
              model: { type: 'string' },
            },
            required: ['valid', 'model'],
          },
        },
        {
          name: 'generate_image',
          description: TOOL_DESCRIPTIONS.generate_image,
          annotations: {
            title: 'Generate image',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              model: { type: 'string' },
              aspect_ratio: {
                type: 'string',
                enum: [
                  '1:1',
                  '2:3',
                  '3:2',
                  '3:4',
                  '4:3',
                  '4:5',
                  '5:4',
                  '9:16',
                  '16:9',
                  '21:9',
                  '1:4',
                  '4:1',
                  '1:8',
                  '8:1',
                ],
              },
              image_size: { type: 'string', enum: ['0.5K', '1K', '2K', '4K'] },
              max_tokens: { type: 'number', minimum: 1 },
              save_path: { type: 'string' },
              input_images: { type: 'array', items: { type: 'string' } },
              modalities: { type: 'array', items: { type: 'string' } },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'generate_audio',
          description: TOOL_DESCRIPTIONS.generate_audio,
          annotations: {
            title: 'Generate audio',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              model: { type: 'string' },
              voice: { type: 'string' },
              format: { type: 'string' },
              save_path: { type: 'string' },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'generate_video',
          description: TOOL_DESCRIPTIONS.generate_video,
          annotations: {
            title: 'Generate video',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              model: { type: 'string' },
              resolution: { type: 'string' },
              aspect_ratio: { type: 'string' },
              duration: { type: 'number', minimum: 1 },
              seed: { type: 'number' },
              first_frame_image: { type: 'string' },
              last_frame_image: { type: 'string' },
              reference_images: { type: 'array', items: { type: 'string' } },
              provider: { type: 'object' },
              save_path: { type: 'string' },
              max_wait_ms: { type: 'number', minimum: 10000 },
              poll_interval_ms: { type: 'number', minimum: 2000 },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'generate_video_from_image',
          description: TOOL_DESCRIPTIONS.generate_video_from_image,
          annotations: {
            title: 'Generate video from image',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              image: {
                type: 'string',
                description: 'First-frame image (path, URL, or data URL). Required.',
              },
              prompt: { type: 'string' },
              model: { type: 'string' },
              resolution: { type: 'string' },
              aspect_ratio: { type: 'string' },
              duration: { type: 'number', minimum: 1 },
              seed: { type: 'number' },
              save_path: { type: 'string' },
              max_wait_ms: { type: 'number', minimum: 10000 },
              poll_interval_ms: { type: 'number', minimum: 2000 },
            },
            required: ['image', 'prompt'],
          },
        },
        {
          name: 'get_video_status',
          description: TOOL_DESCRIPTIONS.get_video_status,
          annotations: {
            title: 'Get video status',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              video_id: { type: 'string' },
              save_path: { type: 'string' },
            },
            required: ['video_id'],
          },
        },
        {
          name: 'rerank_documents',
          description: TOOL_DESCRIPTIONS.rerank_documents,
          annotations: {
            title: 'Rerank documents',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              documents: { type: 'array', items: { type: 'string' }, minItems: 1 },
              model: { type: 'string' },
              top_n: { type: 'number', minimum: 1 },
              return_documents: { type: 'boolean' },
            },
            required: ['query', 'documents'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              model: { type: 'string' },
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    index: { type: 'number' },
                    score: { type: 'number' },
                    document: { type: 'string' },
                  },
                  required: ['index', 'score'],
                },
              },
            },
            required: ['results'],
          },
        },
        {
          name: 'health_check',
          description: TOOL_DESCRIPTIONS.health_check,
          annotations: {
            title: 'Health check',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
          inputSchema: { type: 'object', properties: {} },
          outputSchema: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              server_version: { type: 'string' },
              protocol_version: { type: 'string' },
              api_key_valid: { type: 'boolean' },
              models_cached: { type: 'number' },
              error: { type: 'string' },
            },
            required: [
              'ok',
              'server_version',
              'protocol_version',
              'api_key_valid',
              'models_cached',
            ],
          },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params;
      // Our handlers return structured shapes that satisfy CallToolResult's
      // open interface (content + optional _meta + optional isError +
      // optional structuredContent). We cast through unknown because
      // several handlers include server-specific _meta keys (e.g.
      // server_version, cache, code) that aren't listed in the SDK's
      // typed schema — the SDK accepts any extras thanks to the
      // `[x: string]: unknown` index signature.
      const dispatch = async (): Promise<unknown> => {
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
          case 'analyze_audio':
            return handleAnalyzeAudio(
              wrapToolArgs(args as AnalyzeAudioToolRequest | undefined),
              this.openai,
              this.defaultModel,
            );
          case 'analyze_video':
            return handleAnalyzeVideo(
              wrapToolArgs(args as AnalyzeVideoToolRequest | undefined),
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
          case 'generate_audio':
            return handleGenerateAudio(
              wrapToolArgs(args as GenerateAudioToolRequest | undefined),
              this.openai,
            );
          case 'generate_video':
            return handleGenerateVideo(
              wrapToolArgs(args as GenerateVideoToolRequest | undefined),
              this.apiClient,
              buildProgressHook(this.server, extractProgressToken(request)),
            );
          case 'generate_video_from_image':
            return handleGenerateVideoFromImage(
              wrapToolArgs(args as GenerateVideoFromImageRequest | undefined),
              this.apiClient,
              buildProgressHook(this.server, extractProgressToken(request)),
            );
          case 'get_video_status':
            return handleGetVideoStatus(
              wrapToolArgs(args as GetVideoStatusToolRequest | undefined),
              this.apiClient,
            );
          case 'rerank_documents':
            return handleRerankDocuments(
              wrapToolArgs(args as RerankDocumentsRequest | undefined),
              this.apiClient,
            );
          case 'health_check':
            return handleHealthCheck(
              wrapToolArgs(args as Record<string, unknown> | undefined),
              this.apiClient,
              this.modelCache,
            );
          default:
            throw new McpError(McpErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      };
      return (await dispatch()) as CallToolResult;
    });
  }
}
