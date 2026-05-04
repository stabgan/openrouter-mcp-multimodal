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

function extractProgressToken(
  req: unknown,
): string | number | undefined {
  const meta = (req as { params?: { _meta?: { progressToken?: string | number } } })?.params
    ?._meta;
  return meta?.progressToken;
}

// ---------------------------------------------------------------------------
// Tool descriptions include explicit "Fails when" and "Works with" sections
// per arxiv 2602.18764 (Schema-Guided Dialogue / MCP convergence). Explicit
// failure-mode documentation reduces misrouted calls and helps the model
// pick the right recovery path after an error.

const TOOL_DESCRIPTIONS = {
  chat_completion:
    'Send messages to an OpenRouter model and get a text response. Supports provider routing ' +
    '(quantizations / ignore / sort / order / require_parameters / data_collection / allow_fallbacks), ' +
    'model variant suffixes (`:nitro` fastest, `:floor` cheapest, `:exacto` tool-calling accuracy), ' +
    'reasoning token passthrough, web search, and response caching.\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: messages array is empty\n' +
    '- UPSTREAM_REFUSED: provider rejected the request (credits, content policy, or rate limit)\n' +
    '- UPSTREAM_TIMEOUT: upstream did not respond within the SDK timeout\n' +
    '- MODEL_NOT_FOUND: model slug does not exist on OpenRouter\n\n' +
    'Works with: validate_model (pre-flight model id check), search_models (discover models).',
  analyze_image:
    'Analyze an image with a vision model. Accepts local file paths, http(s) URLs, or base64 data URLs. ' +
    'Output is model-generated and tagged `_meta.content_is_untrusted: true`.\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: image_path missing or malformed\n' +
    '- UNSAFE_PATH: local path escaped the sandbox\n' +
    '- RESOURCE_TOO_LARGE: image exceeded configured fetch size cap\n' +
    '- UPSTREAM_REFUSED: provider SSRF guard blocked the URL or content policy rejected\n\n' +
    'Works with: search_models (find vision-capable models), generate_image (follow-up creation).',
  analyze_audio:
    'Transcribe or analyze an audio file (WAV / MP3 / FLAC / OGG / etc.) using a multimodal model. ' +
    'Output is tagged `_meta.content_is_untrusted: true`.\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: audio_path missing\n' +
    '- UNSUPPORTED_FORMAT: decoder could not identify the file as audio\n' +
    '- RESOURCE_TOO_LARGE: input exceeded size cap\n' +
    '- UPSTREAM_REFUSED: blocked host or content policy\n\n' +
    'Works with: generate_audio (text-to-speech follow-up).',
  analyze_video:
    'Describe or analyze a video (mp4 / mpeg / mov / webm) using a multimodal model. Default model: ' +
    'google/gemini-2.5-flash. Output is tagged `_meta.content_is_untrusted: true`.\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: video_path missing\n' +
    '- UNSUPPORTED_FORMAT: not a recognized video container\n' +
    '- RESOURCE_TOO_LARGE: exceeds fetch cap\n' +
    '- UPSTREAM_REFUSED: SSRF block or provider refusal\n\n' +
    'Works with: generate_video (text-to-video), get_video_status (poll async jobs).',
  search_models:
    'Search OpenRouter\'s model catalog by name, provider, or capability. Returns a paginated list; ' +
    'use `offset` / `limit` / `next_offset` to page through.\n\n' +
    'Fails when:\n' +
    '- UPSTREAM_HTTP: /models endpoint returned an error\n' +
    '- UPSTREAM_REFUSED: invalid API key\n\n' +
    'Works with: validate_model, get_model_info.',
  get_model_info:
    'Get pricing / context-length / capability details for a specific model id.\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: model not provided\n' +
    '- MODEL_NOT_FOUND: model slug does not exist\n' +
    '- UPSTREAM_HTTP: model list fetch failed\n\n' +
    'Works with: search_models (discover ids), validate_model (cheap existence check).',
  validate_model:
    'Check whether a model id exists on OpenRouter. Cheap boolean lookup against the cached catalog.\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: model not provided\n' +
    '- UPSTREAM_HTTP: catalog refresh failed\n\n' +
    'Works with: get_model_info (detailed lookup), chat_completion (pre-flight validation).',
  generate_image:
    'Generate an image from a text prompt. Optional reference images condition the output for style / ' +
    'identity consistency. Default model: google/gemini-2.5-flash-image.\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: prompt empty, bad aspect_ratio / image_size, unreadable reference image\n' +
    '- UNSAFE_PATH: save_path or input_images path escaped the sandbox\n' +
    '- UPSTREAM_REFUSED: provider content policy rejected or insufficient credits\n' +
    '- MODEL_NOT_FOUND: model slug invalid\n\n' +
    'Works with: analyze_image (verify the result), generate_video_from_image (next step in workflow).',
  generate_audio:
    'Generate audio (speech / music) from a text prompt. Format auto-detected, extension auto-corrected.\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: prompt empty\n' +
    '- UNSAFE_PATH: save_path escaped the sandbox\n' +
    '- UPSTREAM_REFUSED: content policy or credit issues\n\n' +
    'Works with: analyze_audio (verify the result).',
  generate_video:
    'Generate a video from a text prompt (optionally conditioned on first/last-frame or reference images). ' +
    'Submits an async job, polls until completion or max_wait_ms, and downloads the result. Emits MCP ' +
    'progress notifications when the client provides a `progressToken`. Default model: google/veo-3.1.\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: prompt empty\n' +
    '- UNSAFE_PATH: save_path or reference image paths escaped the sandbox\n' +
    '- UPSTREAM_REFUSED: content policy, credits, or bad request\n' +
    '- JOB_FAILED: provider marked the job as failed\n' +
    '- UNSUPPORTED_FORMAT: reference/frame image could not be decoded\n\n' +
    'Returns successfully with `_meta.code: JOB_STILL_RUNNING` (NOT an error) when the timeout ' +
    'elapses — the response carries `_meta.video_id` so callers can resume via get_video_status.\n\n' +
    'Works with: get_video_status (resume timed-out jobs), generate_video_from_image (narrower image-to-video variant).',
  generate_video_from_image:
    'Narrower convenience wrapper around generate_video for image-to-video workflows. Takes a single ' +
    '`image` argument (used as the first frame) and `prompt`. Per arxiv 2511.03497, narrower tools with ' +
    'fewer parameters improve tool-call hit rate. For last-frame conditioning or reference images, use ' +
    'generate_video directly.\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: image or prompt missing\n' +
    '- UNSAFE_PATH: image path escaped the sandbox\n' +
    '- UPSTREAM_REFUSED / JOB_FAILED: same as generate_video\n\n' +
    'Returns successfully with `_meta.code: JOB_STILL_RUNNING` on timeout (resumable via ' +
    'get_video_status).\n\n' +
    'Works with: generate_video (full parameter surface), get_video_status.',
  get_video_status:
    'Poll an async video-generation job by id. Downloads the result when complete (and saves if save_path given).\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: video_id missing\n' +
    '- UNSAFE_PATH: save_path escaped the sandbox\n' +
    '- JOB_FAILED: provider marked the job as failed\n\n' +
    'Returns successfully with `_meta.code: JOB_STILL_RUNNING` (NOT an error) when the job is still ' +
    'in flight — response carries `_meta.last_status` and `_meta.progress` so callers can retry later.\n\n' +
    'Works with: generate_video, generate_video_from_image.',
  rerank_documents:
    'Re-order a list of documents by relevance to a query using an OpenRouter reranker. Default model: ' +
    'cohere/rerank-english-v3.0.\n\n' +
    'Fails when:\n' +
    '- INVALID_INPUT: query missing, documents empty, non-string document elements\n' +
    '- MODEL_NOT_FOUND: reranker model slug does not exist\n' +
    '- UPSTREAM_HTTP: provider returned an error\n\n' +
    'Works with: search_models (discover rerankers), chat_completion (answer grounded in top-ranked docs).',
  health_check:
    'Verify API-key validity, OpenRouter reachability, and return server + protocol versions. No args.\n\n' +
    'Fails when: never returns an error result — always returns `{ ok, api_key_valid, ... }` so ops can ' +
    'programmatically branch on the payload.\n\n' +
    'Works with: every other tool (run once at startup to confirm credentials).',
} as const;

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
                  'Surface the model\'s chain-of-thought on `_meta.reasoning` for R1 / Opus 4.7 / Gemini Thinking.',
              },
              online: {
                type: 'boolean',
                description:
                  'Enable OpenRouter\'s web-search plugin (Exa-backed, $4 / 1000 results).',
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
              image_path: { type: 'string', description: 'File path, URL, or data URL' },
              question: { type: 'string', description: 'Question about the image' },
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
                description: 'File path, URL, or data URL (base64-encoded audio)',
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
                  'File path, HTTP(S) URL, or base64 data URL. Supported: mp4 / mpeg / mov / webm.',
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
            required: ['ok', 'server_version', 'protocol_version', 'api_key_valid', 'models_cached'],
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
