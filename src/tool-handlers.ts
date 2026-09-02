import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode as McpErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import OpenAI from 'openai';
import { createOpenRouterOpenAIClient } from './openrouter-openai-client.js';
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
import { handleGenerateImageDedicated } from './tool-handlers/generate-image-dedicated.js';
import { handleTextToSpeech } from './tool-handlers/text-to-speech.js';
import { handleSpeechToText } from './tool-handlers/speech-to-text.js';
import {
  handleStartChatCompletion,
  handleGetChatCompletionStatus,
} from './tool-handlers/async-chat.js';
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
import type { GenerateImageDedicatedRequest } from './tool-handlers/generate-image-dedicated.js';
import type { TextToSpeechRequest } from './tool-handlers/text-to-speech.js';
import type { SpeechToTextRequest } from './tool-handlers/speech-to-text.js';
import type {
  StartChatCompletionRequest,
  GetChatCompletionStatusRequest,
} from './tool-handlers/async-chat.js';
import { TOOL_DEFINITIONS } from './tool-definitions.js';
import { TOOL_ICONS } from './tool-icons.js';

function wrapToolArgs<T extends object>(a: T | undefined): { params: { arguments: T } } {
  return { params: { arguments: a ?? ({} as T) } };
}

/**
 * Optional progress hook for video polling. Wired to MCP notifications when
 * the client passes `progressToken` in request `_meta`.
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
  // MCP progress must monotonically increase; upstream values can drop or be omitted.
  let lastSent = -1;
  return ({ status, progress, attempt, video_id }) => {
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
    this.openai = createOpenRouterOpenAIClient(apiKey);
    this.server = server;

    this.register(server);
  }

  private register(server: Server) {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOL_DEFINITIONS.map((tool) => ({
        ...tool,
        icons: TOOL_ICONS[tool.name as string],
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params;
      // Handlers return extra _meta keys not in the SDK type.
      const dispatch = async (): Promise<unknown> => {
        switch (name) {
          case 'chat_completion':
            return handleChatCompletion(
              wrapToolArgs(args as ChatCompletionToolRequest | undefined),
              this.openai,
              this.defaultModel,
            );
          case 'start_chat_completion':
            return handleStartChatCompletion(
              wrapToolArgs(args as StartChatCompletionRequest | undefined),
              this.openai,
              this.defaultModel,
            );
          case 'get_chat_completion_status':
            return handleGetChatCompletionStatus(
              wrapToolArgs(args as GetChatCompletionStatusRequest | undefined),
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
          case 'generate_image_dedicated':
            return handleGenerateImageDedicated(
              wrapToolArgs(args as GenerateImageDedicatedRequest | undefined),
              this.apiClient,
            );
          case 'generate_audio':
            return handleGenerateAudio(
              wrapToolArgs(args as GenerateAudioToolRequest | undefined),
              this.openai,
            );
          case 'text_to_speech':
            return handleTextToSpeech(
              wrapToolArgs(args as TextToSpeechRequest | undefined),
              this.apiClient,
            );
          case 'speech_to_text':
            return handleSpeechToText(
              wrapToolArgs(args as SpeechToTextRequest | undefined),
              this.apiClient,
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
