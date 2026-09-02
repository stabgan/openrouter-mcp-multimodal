import { TOOL_DESCRIPTIONS, TOOL_NAMES } from './tool-descriptions.js';

/** Aspect ratios accepted by generate_image and generate_image_dedicated handlers. */
export const IMAGE_ASPECT_RATIOS = [
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
] as const;

export const IMAGE_SIZES = ['0.5K', '1K', '2K', '4K'] as const;

export const IMAGE_DEDICATED_RESOLUTIONS = ['512', '0.5K', '1K', '2K', '4K'] as const;

export const IMAGE_DEDICATED_QUALITIES = ['auto', 'low', 'medium', 'high'] as const;

export const IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp', 'svg'] as const;

/** generate_audio handler VALID_FORMATS */
export const GENERATE_AUDIO_FORMATS = ['wav', 'mp3', 'flac', 'opus', 'pcm16'] as const;

/** text_to_speech handler VALID_FORMATS */
export const TTS_RESPONSE_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const;

/** speech_to_text handler VALID_RESPONSE_FORMATS */
export const STT_RESPONSE_FORMATS = ['json', 'text', 'srt', 'verbose_json', 'vtt'] as const;

export const CHAT_MESSAGE_ROLES = ['system', 'user', 'assistant'] as const;

export const PROVIDER_SORT_VALUES = ['price', 'throughput', 'latency'] as const;

export const PROVIDER_DATA_COLLECTION = ['allow', 'deny'] as const;

/** Tools whose handlers accept save_path (binary artifact output). */
export const TOOLS_WITH_SAVE_PATH = [
  'generate_image',
  'generate_image_dedicated',
  'generate_audio',
  'text_to_speech',
  'generate_video',
  'generate_video_from_image',
  'get_video_status',
] as const;

/** Shared save_path fragment for binary-output tools. */
export const SAVE_PATH_PROPERTY = {
  type: 'string',
  description:
    'Write the artifact under OPENROUTER_OUTPUT_DIR (path-sandboxed). When set, the tool result is text-only with _meta.save_path — no inline media block. ' +
    'When unset, inline image/audio (default 1 MiB) or video (default 10 MiB) is returned only if under the per-kind ceiling: ' +
    'OPENROUTER_IMAGE_INLINE_MAX_BYTES, OPENROUTER_AUDIO_INLINE_MAX_BYTES, OPENROUTER_VIDEO_INLINE_MAX_BYTES ' +
    '(global fallback OPENROUTER_INLINE_MAX_BYTES). See .env.example.',
} as const;

const SAVE_PATH_WITH_PREFIX = (prefix: string) => ({
  ...SAVE_PATH_PROPERTY,
  description: `${prefix} ${SAVE_PATH_PROPERTY.description}`,
});

const CHAT_MESSAGE_SCHEMA = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: [...CHAT_MESSAGE_ROLES] },
      content: {
        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }],
      },
    },
    required: ['role', 'content'],
  },
} as const;

const CACHE_PROPERTIES = {
  cache: {
    type: 'boolean',
    description:
      'Enable OpenRouter response caching via `X-OpenRouter-Cache: true`. Server default: `OPENROUTER_CACHE_RESPONSES=1`.',
  },
  cache_ttl: {
    type: 'string',
    description:
      'Cache TTL as integer seconds (1–86400) or a duration string such as "30s", "5m", or "1h". Sent upstream as seconds.',
  },
  cache_clear: {
    type: 'boolean',
    description: 'Bust the cache entry for this exact request.',
  },
} as const;

export const TOOL_DEFINITIONS = [
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
            'Model ID (optional, uses server default). Append `:nitro` (fastest), `:floor` (cheapest), `:free`, `:online` (web search), or `:exacto` (tool accuracy). Example: `openai/gpt-4o:nitro`. Or pass `online: true` for programmatic web search.',
        },
        messages: CHAT_MESSAGE_SCHEMA,
        temperature: { type: 'number', minimum: 0, maximum: 2, description: 'Default: 1.' },
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
              description: 'Exclude these provider slugs.',
            },
            sort: { type: 'string', enum: [...PROVIDER_SORT_VALUES] },
            order: { type: 'array', items: { type: 'string' } },
            require_parameters: { type: 'boolean' },
            data_collection: { type: 'string', enum: [...PROVIDER_DATA_COLLECTION] },
            allow_fallbacks: { type: 'boolean' },
          },
        },
        include_reasoning: {
          type: 'boolean',
          description:
            "Surface the model's chain-of-thought on `_meta.reasoning` for R1 / Opus / Gemini Thinking models.",
        },
        online: {
          type: 'boolean',
          description: "Enable OpenRouter's web-search plugin (Exa-backed, $4 / 1000 results).",
        },
        web_max_results: {
          type: 'number',
          minimum: 1,
          description: 'Max web-search results when `online: true` (default 5).',
        },
        ...CACHE_PROPERTIES,
      },
      required: ['messages'],
    },
  },
  {
    name: 'start_chat_completion',
    description: TOOL_DESCRIPTIONS.start_chat_completion,
    annotations: {
      title: 'Start async chat completion',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Model ID (same options as chat_completion).' },
        messages: CHAT_MESSAGE_SCHEMA,
        temperature: { type: 'number', minimum: 0, maximum: 2 },
        max_tokens: { type: 'number', minimum: 1 },
        provider: { type: 'object' },
        include_reasoning: { type: 'boolean' },
        online: { type: 'boolean' },
        web_max_results: { type: 'number', minimum: 1 },
        ...CACHE_PROPERTIES,
      },
      required: ['messages'],
    },
  },
  {
    name: 'get_chat_completion_status',
    description: TOOL_DESCRIPTIONS.get_chat_completion_status,
    annotations: {
      title: 'Get async chat completion status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: 'The job_id returned by start_chat_completion.',
        },
      },
      required: ['job_id'],
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
            'Local path (OPENROUTER_INPUT_DIR sandbox), https URL, or data URL. Good: `"photo.jpg"`. Bad: `"url": "..."` (wrong key), `"/etc/passwd"` (UNSAFE_PATH).',
        },
        question: {
          type: 'string',
          description:
            'Optional question. Default: "What\'s in this image?". Bad: using `prompt` (wrong key for this tool).',
        },
        model: {
          type: 'string',
          description: 'Vision model ID (optional; server default is a free multimodal model).',
        },
        cache_input: {
          type: 'boolean',
          description:
            'Attach `cache_control: ephemeral` to the image block for Anthropic / Gemini prompt caching.',
        },
        ...CACHE_PROPERTIES,
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
            'Local file path (sandboxed), http(s) URL, or data URL (base64-encoded audio).',
        },
        question: {
          type: 'string',
          description:
            'Question or instruction. Default: "Please transcribe and analyze this audio file."',
        },
        model: {
          type: 'string',
          description: 'Multimodal model ID (default: google/gemini-2.5-flash).',
        },
        cache_input: { type: 'boolean' },
        ...CACHE_PROPERTIES,
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
            'Local file path (sandboxed), http(s) URL, or base64 data URL. Supported containers: mp4, mpeg, mov, webm.',
        },
        question: {
          type: 'string',
          description:
            'Optional question. Default: "Describe what happens in this video, step by step."',
        },
        model: {
          type: 'string',
          description: 'Video-capable model ID (default: google/gemini-2.5-flash).',
        },
        cache_input: { type: 'boolean' },
        ...CACHE_PROPERTIES,
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
        query: { type: 'string', description: 'Substring match against model id or name.' },
        provider: {
          type: 'string',
          description: 'Filter by provider slug prefix (e.g. `google`).',
        },
        capabilities: {
          type: 'object',
          properties: {
            vision: { type: 'boolean' },
            audio: { type: 'boolean' },
            video: { type: 'boolean' },
          },
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 50,
          description: 'Page size (default 20, max 50).',
        },
        offset: { type: 'number', minimum: 0, description: 'Pagination offset (default 0).' },
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
      properties: {
        model: {
          type: 'string',
          description: 'Full OpenRouter model slug (e.g. `openai/gpt-4o`).',
        },
      },
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
      properties: {
        model: { type: 'string', description: 'Full OpenRouter model slug to check.' },
      },
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
        prompt: { type: 'string', description: 'Text prompt describing the image to generate.' },
        model: {
          type: 'string',
          description:
            'Image model ID (default: google/gemini-2.5-flash-image). Chat-completions route.',
        },
        aspect_ratio: {
          type: 'string',
          enum: [...IMAGE_ASPECT_RATIOS],
          description: 'Optional aspect ratio (provider-dependent).',
        },
        image_size: {
          type: 'string',
          enum: [...IMAGE_SIZES],
          description: 'Optional resolution tier for supported models.',
        },
        max_tokens: { type: 'number', minimum: 1, description: 'Optional completion token cap.' },
        save_path: SAVE_PATH_PROPERTY,
        input_images: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Reference images (local path, URL, or data URL) for style/identity conditioning.',
        },
        modalities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Response modalities (default: `["image","text"]`).',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_image_dedicated',
    description: TOOL_DESCRIPTIONS.generate_image_dedicated,
    annotations: {
      title: 'Generate image (dedicated API)',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text prompt describing the image to generate.',
        },
        model: {
          type: 'string',
          description:
            'Image model ID. Default: google/gemini-2.5-flash-image. Browse: https://openrouter.ai/collections/image-models',
        },
        resolution: {
          type: 'string',
          enum: [...IMAGE_DEDICATED_RESOLUTIONS],
          description: 'Normalized resolution tier. Provider maps to closest supported size.',
        },
        aspect_ratio: {
          type: 'string',
          enum: [...IMAGE_ASPECT_RATIOS],
          description: 'Aspect ratio (same enum as generate_image).',
        },
        quality: {
          type: 'string',
          enum: [...IMAGE_DEDICATED_QUALITIES],
          description: 'Image quality level (default: auto).',
        },
        output_format: {
          type: 'string',
          enum: [...IMAGE_OUTPUT_FORMATS],
          description: 'Output image format.',
        },
        n: {
          type: 'number',
          minimum: 1,
          maximum: 10,
          description: 'Number of images to request (default 1; only images[0] is saved/inlined).',
        },
        input_references: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Reference images for image-to-image. Each entry: local path, http(s) URL, or data URL.',
        },
        save_path: SAVE_PATH_WITH_PREFIX('Save generated image to this path.'),
        provider: {
          type: 'object',
          description: 'Provider routing overrides (order, sort, allow_fallbacks, etc.).',
        },
        ...CACHE_PROPERTIES,
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
        prompt: { type: 'string', description: 'Text prompt for speech or music generation.' },
        model: {
          type: 'string',
          description: 'Chat-completions audio model (default: openai/gpt-audio).',
        },
        voice: {
          type: 'string',
          description: 'Voice ID (default: alloy). Model-specific.',
        },
        format: {
          type: 'string',
          enum: [...GENERATE_AUDIO_FORMATS],
          description: 'Output audio format (default: pcm16, auto-wrapped as WAV when needed).',
        },
        save_path: SAVE_PATH_PROPERTY,
      },
      required: ['prompt'],
    },
  },
  {
    name: 'text_to_speech',
    description: TOOL_DESCRIPTIONS.text_to_speech,
    annotations: {
      title: 'Text to speech (dedicated API)',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Text to convert to speech.',
        },
        model: {
          type: 'string',
          description:
            'TTS model for OpenRouter POST /audio/speech. Pass explicitly: the previous default was retired upstream and OpenRouter publishes no TTS model list.',
        },
        voice: {
          type: 'string',
          description:
            'Voice ID (model-specific). Default: alloy. OpenAI voices: alloy, echo, fable, onyx, nova, shimmer.',
        },
        response_format: {
          type: 'string',
          enum: [...TTS_RESPONSE_FORMATS],
          description: 'Output audio format. Default: mp3.',
        },
        speed: {
          type: 'number',
          minimum: 0.25,
          maximum: 4.0,
          description: 'Speed of speech (0.25–4.0). Default: 1.0.',
        },
        instructions: {
          type: 'string',
          description:
            'Tone/style instructions (e.g. "speak in a warm, friendly tone"). OpenAI models only.',
        },
        save_path: SAVE_PATH_WITH_PREFIX('Save audio to this path.'),
        ...CACHE_PROPERTIES,
      },
      required: ['input'],
    },
  },
  {
    name: 'speech_to_text',
    description: TOOL_DESCRIPTIONS.speech_to_text,
    annotations: {
      title: 'Speech to text (dedicated API)',
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
            'Audio file: local path (sandboxed), http(s) URL, or base64 data URL. Formats: mp3, wav, flac, ogg, webm, mp4, m4a.',
        },
        model: {
          type: 'string',
          description:
            'STT model. Default: openai/whisper-1. Also: openai/gpt-4o-transcribe, openai/gpt-4o-mini-transcribe.',
        },
        language: {
          type: 'string',
          description: 'ISO-639-1 language code (e.g. "en", "es", "fr"). Improves accuracy.',
        },
        response_format: {
          type: 'string',
          enum: [...STT_RESPONSE_FORMATS],
          description: 'Output format for transcription. Default: json.',
        },
        temperature: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Sampling temperature for transcription (0–1).',
        },
        ...CACHE_PROPERTIES,
      },
      required: ['audio_path'],
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
        prompt: { type: 'string', description: 'Text prompt describing the video to generate.' },
        model: {
          type: 'string',
          description: 'Video model ID (default: google/veo-3.1). Passed through to provider.',
        },
        resolution: {
          type: 'string',
          description: 'Provider-specific resolution (e.g. "720p", "1080p"). No server-side enum.',
        },
        aspect_ratio: {
          type: 'string',
          description: 'Provider-specific aspect ratio (e.g. "16:9", "9:16"). No server-side enum.',
        },
        duration: {
          type: 'number',
          minimum: 1,
          description: 'Clip duration in seconds (provider-dependent).',
        },
        seed: { type: 'number', description: 'Optional reproducibility seed.' },
        first_frame_image: {
          type: 'string',
          description: 'Optional first-frame image (path, URL, or data URL).',
        },
        last_frame_image: {
          type: 'string',
          description: 'Optional last-frame image (path, URL, or data URL).',
        },
        reference_images: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reference images for style/subject guidance.',
        },
        provider: { type: 'object', description: 'Provider routing overrides.' },
        save_path: SAVE_PATH_PROPERTY,
        max_wait_ms: {
          type: 'number',
          minimum: 100,
          description:
            'Max time to poll before returning JOB_STILL_RUNNING (ms). Default: 600000 (10 min) via OPENROUTER_VIDEO_MAX_WAIT_MS.',
        },
        poll_interval_ms: {
          type: 'number',
          minimum: 50,
          description:
            'Poll interval while waiting (ms). Default: 15000 via OPENROUTER_VIDEO_POLL_INTERVAL_MS.',
        },
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
        prompt: { type: 'string', description: 'Motion/scene prompt describing the video.' },
        model: { type: 'string', description: 'Video model ID (default: google/veo-3.1).' },
        resolution: { type: 'string', description: 'Provider-specific resolution.' },
        aspect_ratio: { type: 'string', description: 'Provider-specific aspect ratio.' },
        duration: { type: 'number', minimum: 1, description: 'Clip duration in seconds.' },
        seed: { type: 'number', description: 'Optional reproducibility seed.' },
        save_path: SAVE_PATH_PROPERTY,
        max_wait_ms: {
          type: 'number',
          minimum: 100,
          description: 'Max poll wait (ms) before JOB_STILL_RUNNING. Default: 600000.',
        },
        poll_interval_ms: {
          type: 'number',
          minimum: 50,
          description: 'Poll interval (ms). Default: 15000.',
        },
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
        video_id: {
          type: 'string',
          description: 'Video job id from generate_video / generate_video_from_image.',
        },
        save_path: SAVE_PATH_PROPERTY,
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
        query: { type: 'string', description: 'Search query to rank documents against.' },
        documents: { type: 'array', items: { type: 'string' }, minItems: 1 },
        model: {
          type: 'string',
          description: 'Reranker model (default: cohere/rerank-v3.5).',
        },
        top_n: { type: 'number', minimum: 1, description: 'Return only the top N results.' },
        return_documents: {
          type: 'boolean',
          description: 'When true, include original document text in each result.',
        },
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
] as Array<Record<string, unknown>>;

/** Tool names from definitions — must match TOOL_NAMES in tool-descriptions.ts. */
export const TOOL_DEFINITION_NAMES = TOOL_DEFINITIONS.map((t) => t.name);

if (TOOL_DEFINITION_NAMES.length !== TOOL_NAMES.length) {
  throw new Error(
    `Tool count mismatch: definitions=${TOOL_DEFINITION_NAMES.length} descriptions=${TOOL_NAMES.length}`,
  );
}
for (const name of TOOL_NAMES) {
  if (!TOOL_DEFINITION_NAMES.includes(name)) {
    throw new Error(`Missing tool definition for ${name}`);
  }
}
