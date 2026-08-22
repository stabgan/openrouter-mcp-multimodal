import { TOOL_DESCRIPTIONS } from './tool-descriptions.js';

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
            'Model ID (optional, uses default). Append `:nitro` for the fastest variant, ' +
            '`:floor` for the cheapest, `:free` for the free tier, `:online` for web search, ' +
            'or `:exacto` for the best tool-calling accuracy. ' +
            'Example: `openai/gpt-4o:nitro`. Or pass `online: true` for programmatic web search control.',
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
          description: "Enable OpenRouter's web-search plugin (Exa-backed, $4 / 1000 results).",
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
        model: { type: 'string', description: 'Model ID (same as chat_completion).' },
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
        provider: { type: 'object' },
        include_reasoning: { type: 'boolean' },
        online: { type: 'boolean' },
        web_max_results: { type: 'number', minimum: 1 },
        cache: { type: 'boolean' },
        cache_ttl: { type: 'string' },
        cache_clear: { type: 'boolean' },
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
            'Image model ID. Default: google/gemini-2.5-flash-image. Browse available at https://openrouter.ai/collections/image-models',
        },
        resolution: {
          type: 'string',
          enum: ['512', '0.5K', '1K', '2K', '4K'],
          description: 'Normalized resolution tier. Provider maps to closest supported size.',
        },
        aspect_ratio: {
          type: 'string',
          description: 'Aspect ratio (e.g. "1:1", "16:9", "9:16", "4:3", "21:9").',
        },
        quality: {
          type: 'string',
          enum: ['auto', 'low', 'medium', 'high'],
          description: 'Image quality level.',
        },
        output_format: {
          type: 'string',
          enum: ['png', 'jpeg', 'webp', 'svg'],
          description: 'Output image format.',
        },
        n: {
          type: 'number',
          minimum: 1,
          maximum: 10,
          description: 'Number of images to generate (model-dependent, default 1).',
        },
        input_references: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Reference images for image-to-image workflows. Each entry: local path, http(s) URL, or data URL.',
        },
        save_path: { type: 'string', description: 'Save generated image to this path.' },
        provider: {
          type: 'object',
          description: 'Provider routing overrides (order, sort, allow_fallbacks, etc.).',
        },
        cache: { type: 'boolean' },
        cache_ttl: { type: 'string' },
        cache_clear: { type: 'boolean' },
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
            'TTS model. Default: openai/gpt-4o-mini-tts-2025-12-15. Also: google/gemini-flash-tts, mistral/voxtral-mini-tts.',
        },
        voice: {
          type: 'string',
          description:
            'Voice ID (model-specific). Default: alloy. OpenAI voices: alloy, echo, fable, onyx, nova, shimmer.',
        },
        response_format: {
          type: 'string',
          enum: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'],
          description: 'Output audio format. Default: mp3.',
        },
        speed: {
          type: 'number',
          minimum: 0.25,
          maximum: 4.0,
          description: 'Speed of speech (0.25 to 4.0). Default: 1.0.',
        },
        instructions: {
          type: 'string',
          description:
            'Tone/style instructions (e.g. "speak in a warm, friendly tone"). OpenAI models only.',
        },
        save_path: { type: 'string', description: 'Save audio to this path.' },
        cache: { type: 'boolean' },
        cache_ttl: { type: 'string' },
        cache_clear: { type: 'boolean' },
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
            'Audio file: local path (sandboxed), http(s) URL, or base64 data URL. Formats: mp3, wav, flac, ogg, webm, mp4.',
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
          enum: ['json', 'text', 'srt', 'verbose_json', 'vtt'],
          description: 'Output format for transcription. Default: json.',
        },
        temperature: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Sampling temperature for transcription (0-1).',
        },
        cache: { type: 'boolean' },
        cache_ttl: { type: 'string' },
        cache_clear: { type: 'boolean' },
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
] as Array<Record<string, unknown>>;
