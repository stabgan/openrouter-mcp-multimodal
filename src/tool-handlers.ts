import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode as McpErrorCode,
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
import { handleAnalyzeVideo } from './tool-handlers/analyze-video.js';
import {
  handleGenerateVideo,
  handleGetVideoStatus,
} from './tool-handlers/generate-video.js';
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
} from './tool-handlers/generate-video.js';

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
          description:
            'Send messages to an OpenRouter model and get a response. Supports provider routing (quantizations / ignore / sort / order / require_parameters / data_collection / allow_fallbacks) and model variant suffixes (`:nitro` for faster, `:floor` for cheapest).',
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
          },
          inputSchema: {
            type: 'object',
            properties: {
              model: {
                type: 'string',
                description:
                  'Model ID (optional, uses default). Append `:nitro` for faster/experimental variants or `:floor` for the cheapest available variant (e.g. `openai/gpt-4o:nitro`).',
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
                  'OpenRouter provider-routing overrides. Merges on top of `OPENROUTER_PROVIDER_*` env defaults. See https://openrouter.ai/docs/features/provider-routing',
                properties: {
                  quantizations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Filter providers by quantization (e.g. `["fp16","int8"]`).',
                  },
                  ignore: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Exclude these provider slugs (e.g. `["openai","anthropic"]`).',
                  },
                  sort: {
                    type: 'string',
                    enum: ['price', 'throughput', 'latency'],
                    description: 'Sort providers by this criterion.',
                  },
                  order: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                      'Prioritized list of provider IDs (e.g. `["openai/gpt-4o","anthropic/claude-3-opus"]`).',
                  },
                  require_parameters: {
                    type: 'boolean',
                    description:
                      'Only use providers that support every parameter in the request.',
                  },
                  data_collection: {
                    type: 'string',
                    enum: ['allow', 'deny'],
                    description: 'Whether providers may collect request data.',
                  },
                  allow_fallbacks: {
                    type: 'boolean',
                    description:
                      'Allow fallback to unlisted providers when preferred ones fail.',
                  },
                },
              },
            },
            required: ['messages'],
          },
        },
        {
          name: 'analyze_image',
          description: 'Analyze an image using a vision model',
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: false,
          },
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
          name: 'analyze_audio',
          description: 'Analyze or transcribe an audio file using a multimodal model',
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: false,
          },
          inputSchema: {
            type: 'object',
            properties: {
              audio_path: {
                type: 'string',
                description: 'File path, URL, or data URL (base64-encoded audio)',
              },
              question: {
                type: 'string',
                description:
                  'Question or instruction about the audio (default: transcribe)',
              },
              model: { type: 'string' },
            },
            required: ['audio_path'],
          },
        },
        {
          name: 'analyze_video',
          description:
            'Analyze or transcribe a video file using a multimodal model. Accepts mp4, mpeg, mov, or webm from a local file path, HTTP(S) URL, or base64 data URL. Default model: google/gemini-2.5-flash.',
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: false,
          },
          inputSchema: {
            type: 'object',
            properties: {
              video_path: {
                type: 'string',
                description:
                  'File path, HTTP(S) URL, or base64 data URL. Supported formats: mp4, mpeg, mov, webm.',
              },
              question: {
                type: 'string',
                description: 'Question or instruction about the video (default: describe).',
              },
              model: { type: 'string', description: 'Override the model ID.' },
            },
            required: ['video_path'],
          },
        },
        {
          name: 'search_models',
          description: 'Search available OpenRouter models',
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
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
            },
          },
        },
        {
          name: 'get_model_info',
          description: 'Get details about a specific model',
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: { model: { type: 'string' } },
            required: ['model'],
          },
        },
        {
          name: 'validate_model',
          description: 'Check if a model ID exists',
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: { model: { type: 'string' } },
            required: ['model'],
          },
        },
        {
          name: 'generate_image',
          description:
            'Generate an image from a text prompt. Optionally conditioned on one or more ' +
            'reference images (file paths, http(s) URLs, or data URLs) for character / style ' +
            'consistency. Sends `modalities: ["image","text"]` by default; override via the ' +
            '`modalities` field if needed.',
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
          },
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              model: { type: 'string' },
              aspect_ratio: {
                type: 'string',
                description:
                  'Output aspect ratio (e.g. 1:1, 16:9, 9:16, 4:3, 3:4, 21:9). Model-dependent.',
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
              image_size: {
                type: 'string',
                description:
                  'Output resolution bucket. 1K is the default; 0.5K / 2K / 4K are model-dependent.',
                enum: ['0.5K', '1K', '2K', '4K'],
              },
              max_tokens: {
                type: 'number',
                minimum: 1,
                description:
                  'Cap on completion tokens. Defaults to the model context window, which can trip free-tier quotas; set e.g. 4096 on low-credit accounts.',
              },
              save_path: {
                type: 'string',
                description:
                  'Optional path to save the image. Routed through the OPENROUTER_OUTPUT_DIR sandbox.',
              },
              input_images: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Optional reference images for visual consistency. Each entry may be a ' +
                  'local file path (sandboxed to OPENROUTER_INPUT_DIR / OPENROUTER_OUTPUT_DIR / ' +
                  'cwd), an http(s) URL, or a `data:image/...;base64,...` URL. Inlined as ' +
                  'multimodal user content in the order given.',
              },
              modalities: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Override the default `modalities: ["image","text"]` sent to OpenRouter. ' +
                  'Most callers should leave this unset. Provide e.g. ["text"] to suppress ' +
                  'image output for inspection / captioning.',
              },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'generate_audio',
          description:
            'Generate audio from a text prompt. Conversational models (e.g. openai/gpt-audio) respond in spoken audio. Music models (e.g. google/lyria-3-clip-preview) need a structured prompt. Output format is auto-detected and file extension is corrected automatically.',
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
          },
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Text input' },
              model: { type: 'string', description: 'Model ID (default: openai/gpt-audio)' },
              voice: { type: 'string', description: 'Voice name (default: alloy)' },
              format: {
                type: 'string',
                description: 'Requested format: pcm16 (default), mp3, flac, opus',
              },
              save_path: {
                type: 'string',
                description:
                  'Optional path to save the audio. Extension auto-corrected and routed through OPENROUTER_OUTPUT_DIR sandbox.',
              },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'generate_video',
          description:
            'Generate a video from a text prompt using an OpenRouter video-generation model (default: google/veo-3.1). ' +
            'Submits an async job, polls until completion or max_wait_ms, then downloads the result. ' +
            'Optionally conditioned on first/last-frame images or reference images. ' +
            'Large outputs are auto-saved when save_path is provided and path-sandboxed.',
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
          },
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Text description of the desired video.' },
              model: { type: 'string', description: 'Override the video model ID.' },
              resolution: {
                type: 'string',
                description: '480p / 720p / 1080p / 1K / 2K / 4K (model-dependent).',
              },
              aspect_ratio: {
                type: 'string',
                description: '16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / 9:21 (model-dependent).',
              },
              duration: {
                type: 'number',
                minimum: 1,
                description: 'Duration in seconds (model-dependent).',
              },
              seed: { type: 'number', description: 'Deterministic seed when supported.' },
              first_frame_image: {
                type: 'string',
                description:
                  'Optional image (path, URL, or data URL) used as the first frame for image-to-video.',
              },
              last_frame_image: {
                type: 'string',
                description: 'Optional image used as the last frame for frame transitions.',
              },
              reference_images: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional style/content reference images.',
              },
              provider: {
                type: 'object',
                description: 'Provider-specific passthrough options keyed by provider slug.',
              },
              save_path: {
                type: 'string',
                description:
                  'Where to save the video. Routed through the OPENROUTER_OUTPUT_DIR sandbox; extension auto-corrected.',
              },
              max_wait_ms: {
                type: 'number',
                minimum: 10000,
                description:
                  'Total time to wait for the async job before returning a resumable handle (default 600000 ms).',
              },
              poll_interval_ms: {
                type: 'number',
                minimum: 2000,
                description: 'Polling cadence (default 15000 ms).',
              },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'get_video_status',
          description:
            'Resume a previously submitted video generation job by id. Returns the latest status; if completed, ' +
            'downloads the video (and saves it when save_path is provided).',
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
          },
          inputSchema: {
            type: 'object',
            properties: {
              video_id: { type: 'string', description: 'Job id from a previous generate_video call.' },
              save_path: {
                type: 'string',
                description:
                  'Optional save path (applies when the job is already completed).',
              },
            },
            required: ['video_id'],
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
          );
        case 'get_video_status':
          return handleGetVideoStatus(
            wrapToolArgs(args as GetVideoStatusToolRequest | undefined),
            this.apiClient,
          );
        default:
          throw new McpError(McpErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    });
  }
}
