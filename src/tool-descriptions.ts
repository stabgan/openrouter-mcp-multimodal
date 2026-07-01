/**
 * MCP tool descriptions with explicit routing, examples, and failure modes.
 * See docs/plans/tool-description-improvement.md for the authoring guide.
 */

export interface ToolDescriptionParts {
  summary: string;
  useWhen: string[];
  notWhen: string[];
  goodExamples: string[];
  badExamples: string[];
  failsWhen: string[];
  worksWith: string[];
}

function formatBullets(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

export function buildToolDescription(parts: ToolDescriptionParts): string {
  return (
    `${parts.summary}\n\n` +
    `Use when:\n${formatBullets(parts.useWhen)}\n\n` +
    `Do NOT use when:\n${formatBullets(parts.notWhen)}\n\n` +
    `Good examples:\n${formatBullets(parts.goodExamples)}\n\n` +
    `Bad examples:\n${formatBullets(parts.badExamples)}\n\n` +
    `Fails when:\n${formatBullets(parts.failsWhen)}\n\n` +
    `Works with: ${parts.worksWith.join(', ')}.`
  );
}

/** Required sections every tool description must contain (regression-tested). */
export const REQUIRED_DESCRIPTION_SECTIONS = [
  'Use when:',
  'Do NOT use when:',
  'Good examples:',
  'Bad examples:',
  'Fails when:',
  'Works with:',
] as const;

export const TOOL_NAMES = [
  'chat_completion',
  'analyze_image',
  'analyze_audio',
  'analyze_video',
  'search_models',
  'get_model_info',
  'validate_model',
  'generate_image',
  'generate_audio',
  'generate_video',
  'generate_video_from_image',
  'get_video_status',
  'rerank_documents',
  'health_check',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  chat_completion: buildToolDescription({
    summary:
      'Send messages to an OpenRouter chat model and get a text reply. Supports provider routing, ' +
      'model suffixes (`:nitro` fastest, `:floor` cheapest, `:exacto` tool accuracy), reasoning ' +
      'tokens, web search (`online: true`), and response caching.',
    useWhen: [
      'You need text generation, Q&A, summarization, or multi-turn dialogue',
      'You want web-grounded answers (`online: true`)',
      'You already know the model id (or rely on the server default)',
    ],
    notWhen: [
      'Input is an image/audio/video file → use analyze_image / analyze_audio / analyze_video',
      'You need to create images, audio, or video → use generate_* tools',
      'You only need to check if a model exists → use validate_model',
    ],
    goodExamples: [
      '`{ "messages": [{ "role": "user", "content": "Explain recursion in one paragraph." }] }`',
      '`{ "model": "openai/gpt-4o:nitro", "messages": [...], "online": true }` for web search',
      '`{ "messages": [...], "include_reasoning": true }` for chain-of-thought models',
    ],
    badExamples: [
      '`{ "messages": [] }` → INVALID_INPUT (empty array)',
      '`{ "image_path": "photo.jpg" }` → wrong tool; use analyze_image',
      'Putting file paths inside message content without a vision model configured',
    ],
    failsWhen: [
      'INVALID_INPUT: messages array is empty',
      'UPSTREAM_REFUSED: credits, content policy, or rate limit',
      'UPSTREAM_TIMEOUT: upstream did not respond in time',
      'MODEL_NOT_FOUND: model slug does not exist on OpenRouter',
    ],
    worksWith: ['validate_model', 'search_models'],
  }),

  analyze_image: buildToolDescription({
    summary:
      'Analyze one image with a vision model. Accepts a sandboxed local path, https URL, or base64 data URL. ' +
      'Output is model-generated and tagged `_meta.content_is_untrusted: true`.',
    useWhen: [
      'You have one image and need OCR, captioning, or visual Q&A',
      'The image is a local file under the input sandbox, a public https URL, or a data URL',
    ],
    notWhen: [
      'You want to generate a new image → use generate_image',
      'You need multi-file batch analysis in one call → not supported; call once per image',
      'Pure text chat → use chat_completion with a vision-capable model instead (less ergonomic)',
    ],
    goodExamples: [
      '`{ "image_path": "diagram.png", "question": "List every label in this diagram." }`',
      '`{ "image_path": "https://example.com/photo.jpg", "question": "Describe the scene." }`',
      '`{ "model": "google/gemini-2.5-flash", "image_path": "scan.jpg", "question": "Extract text" }`',
    ],
    badExamples: [
      '`{ "url": "photo.jpg" }` → wrong key; use `image_path`',
      '`{ "prompt": "describe" }` → wrong key; use `question` (optional, defaults to "What\'s in this image?")',
      '`{ "image_path": "../../../etc/passwd" }` → UNSAFE_PATH (sandbox escape)',
    ],
    failsWhen: [
      'INVALID_INPUT: image_path missing or malformed',
      'UNSAFE_PATH: local path escaped the input sandbox',
      'RESOURCE_TOO_LARGE: image exceeded fetch size cap',
      'UPSTREAM_REFUSED: SSRF block, bad URL, or content policy',
    ],
    worksWith: ['search_models', 'generate_image'],
  }),

  analyze_audio: buildToolDescription({
    summary:
      'Transcribe or analyze one audio file (WAV, MP3, FLAC, OGG, etc.) with a multimodal model. ' +
      'Output is tagged `_meta.content_is_untrusted: true`.',
    useWhen: [
      'You have a local audio file or URL and need transcription or audio understanding',
      'Format is a common audio container the decoder recognizes',
    ],
    notWhen: [
      'You want text-to-speech → use generate_audio',
      'Input is video → use analyze_video (or extract audio first)',
      'Pure text chat → use chat_completion',
    ],
    goodExamples: [
      '`{ "audio_path": "meeting.wav", "question": "Transcribe verbatim." }`',
      '`{ "audio_path": "https://example.com/podcast.mp3", "question": "Summarize topics." }`',
    ],
    badExamples: [
      '`{ "audio_path": "/etc/shadow" }` → UNSAFE_PATH',
      '`{ "path": "song.mp3" }` → wrong key; use `audio_path`',
      'Non-audio binary renamed to .mp3 → UNSUPPORTED_FORMAT',
    ],
    failsWhen: [
      'INVALID_INPUT: audio_path missing',
      'UNSAFE_PATH: local path escaped the sandbox',
      'UNSUPPORTED_FORMAT: file is not recognized as audio',
      'RESOURCE_TOO_LARGE: exceeds size cap',
    ],
    worksWith: ['generate_audio', 'search_models'],
  }),

  analyze_video: buildToolDescription({
    summary:
      'Describe or analyze one video file (mp4, mpeg, mov, webm). Default model: google/gemini-2.5-flash. ' +
      'Output is tagged `_meta.content_is_untrusted: true`. Large files are fully buffered — prefer short clips.',
    useWhen: [
      'You need a summary, scene description, or Q&A over a video file',
      'Video is within size limits and readable by the decoder',
    ],
    notWhen: [
      'You want to generate video → use generate_video',
      'You only need audio → use analyze_audio',
      'Video is very large → trim first or expect RESOURCE_TOO_LARGE',
    ],
    goodExamples: [
      '`{ "video_path": "clip.mp4", "question": "What happens in the first 30 seconds?" }`',
      '`{ "video_path": "demo.webm", "question": "List on-screen text." }`',
    ],
    badExamples: [
      '`{ "video_path": "../secret.mp4" }` → UNSAFE_PATH',
      'Expecting frame-by-frame timestamps without asking in the prompt',
      'Using analyze_video for async generation status → use get_video_status',
    ],
    failsWhen: [
      'INVALID_INPUT: video_path missing',
      'UNSAFE_PATH: path escaped the sandbox',
      'UNSUPPORTED_FORMAT: unrecognized video container',
      'RESOURCE_TOO_LARGE: exceeds fetch cap',
    ],
    worksWith: ['generate_video', 'get_video_status', 'search_models'],
  }),

  search_models: buildToolDescription({
    summary:
      'Search the OpenRouter model catalog by name, provider, or capability. Returns a paginated slice; ' +
      'use `offset`, `limit`, and `next_offset` to page through large result sets.',
    useWhen: [
      'You do not know which model id to use',
      'You need vision/audio/video-capable models filtered by modality',
      'You want models from a specific provider prefix (e.g. `google`)',
    ],
    notWhen: [
      'You already have a model id and only need existence check → validate_model',
      'You need pricing/context details for one id → get_model_info',
      'You expect all 400+ models in one response without paging',
    ],
    goodExamples: [
      '`{ "query": "gemini", "capabilities": { "vision": true }, "limit": 10, "offset": 0 }`',
      '`{ "provider": "anthropic", "limit": 20 }`',
      'Page 2: `{ "query": "llama", "offset": 20, "limit": 20 }` using prior `next_offset`',
    ],
    badExamples: [
      'Omitting pagination on broad queries → large payload; use limit/offset',
      'Using search_models output as chat messages → use returned `id` in chat_completion',
      '`{ "capability": "vision" }` → wrong shape; use `capabilities: { "vision": true }`',
    ],
    failsWhen: ['UPSTREAM_HTTP: /models endpoint error', 'UPSTREAM_REFUSED: invalid API key'],
    worksWith: ['validate_model', 'get_model_info'],
  }),

  get_model_info: buildToolDescription({
    summary:
      'Return pricing, context length, and modality architecture for one model id from the cached catalog.',
    useWhen: [
      'You have a model id and need context window, pricing, or input/output modalities',
      'You are choosing between two known model slugs',
    ],
    notWhen: [
      'You only need true/false existence → validate_model (cheaper)',
      'You are browsing unknown models → search_models first',
    ],
    goodExamples: [
      '`{ "model": "openai/gpt-4o" }`',
      '`{ "model": "google/gemini-2.5-flash" }` before analyze_video',
    ],
    badExamples: [
      '`{ "model": "" }` → INVALID_INPUT',
      '`{ "name": "gpt-4o" }` → wrong key; use `model` with full slug `openai/gpt-4o`',
      'Calling repeatedly in a loop → cache is shared; call once per id',
    ],
    failsWhen: [
      'INVALID_INPUT: model not provided',
      'MODEL_NOT_FOUND: slug not in catalog',
      'UPSTREAM_HTTP: catalog refresh failed',
    ],
    worksWith: ['search_models', 'validate_model'],
  }),

  validate_model: buildToolDescription({
    summary:
      'Cheap boolean check: does this model id exist in the OpenRouter catalog? Uses the shared cache.',
    useWhen: [
      'Pre-flight before chat_completion or generate_* to avoid MODEL_NOT_FOUND',
      'You only need `{ valid: true|false }`, not pricing or modalities',
    ],
    notWhen: [
      'You need pricing or context length → get_model_info',
      'You are discovering models → search_models',
    ],
    goodExamples: [
      '`{ "model": "anthropic/claude-sonnet-4" }` → `{ "valid": true, "model": "..." }`',
      '`{ "model": "fake/model" }` → `{ "valid": false }` (not an error)',
    ],
    badExamples: [
      'Treating `valid: false` as a tool error — it is a successful response',
      'Using validate_model to search partial names → use search_models with `query`',
    ],
    failsWhen: ['INVALID_INPUT: model not provided', 'UPSTREAM_HTTP: catalog refresh failed'],
    worksWith: ['get_model_info', 'chat_completion'],
  }),

  generate_image: buildToolDescription({
    summary:
      'Generate an image from a text prompt. Optional `input_images` condition style/identity. ' +
      'Default model: google/gemini-2.5-flash-image.',
    useWhen: [
      'You need a new image from a text prompt',
      'You have reference images for style or subject consistency',
    ],
    notWhen: [
      'You want to analyze an existing image → analyze_image',
      'You want video → generate_video or generate_video_from_image',
      'Prompt is empty or only whitespace',
    ],
    goodExamples: [
      '`{ "prompt": "A watercolor fox in autumn leaves" }`',
      '`{ "prompt": "Same character", "input_images": ["ref.png"], "aspect_ratio": "16:9" }`',
      '`{ "prompt": "Logo", "save_path": "out/logo.png" }` inside output sandbox',
    ],
    badExamples: [
      '`{ "prompt": "" }` → INVALID_INPUT',
      '`{ "input_images": ["/etc/passwd"] }` → UNSAFE_PATH',
      '`{ "aspect_ratio": "21:9" }` if not in allowed enum → INVALID_INPUT',
    ],
    failsWhen: [
      'INVALID_INPUT: empty prompt, bad aspect_ratio/image_size, unreadable reference',
      'UNSAFE_PATH: save_path or input_images escaped sandbox',
      'UPSTREAM_REFUSED: content policy or insufficient credits',
      'MODEL_NOT_FOUND: invalid model slug',
    ],
    worksWith: ['analyze_image', 'generate_video_from_image'],
  }),

  generate_audio: buildToolDescription({
    summary:
      'Generate speech or music from a text prompt. Output format is auto-detected; file extension auto-corrected on save.',
    useWhen: [
      'You need TTS or audio generation from text',
      'Optional save_path is inside the output sandbox',
    ],
    notWhen: ['You want to transcribe existing audio → analyze_audio', 'Prompt is empty'],
    goodExamples: [
      '`{ "prompt": "Say hello world in a calm voice." }`',
      '`{ "prompt": "Upbeat jingle", "save_path": "out/jingle.mp3" }`',
    ],
    badExamples: [
      '`{ "text": "hello" }` → wrong key; use `prompt`',
      '`{ "save_path": "../../../tmp/out.wav" }` → UNSAFE_PATH',
    ],
    failsWhen: [
      'INVALID_INPUT: prompt empty',
      'UNSAFE_PATH: save_path escaped sandbox',
      'UPSTREAM_REFUSED: content policy or credits',
    ],
    worksWith: ['analyze_audio'],
  }),

  generate_video: buildToolDescription({
    summary:
      'Generate video from a text prompt (optional first/last frame or reference images). Submits an async job, ' +
      'polls until `max_wait_ms`, downloads on completion. Emits MCP progress when client sends `progressToken`. ' +
      'Default model: google/veo-3.1.',
    useWhen: [
      'You need text-to-video or frame-conditioned video',
      'You can wait for polling or resume later with get_video_status',
      'You need last_frame or multiple reference_images (not available on generate_video_from_image)',
    ],
    notWhen: [
      'You only have one image and simple image-to-video → generate_video_from_image (fewer params)',
      'Job already submitted → get_video_status with `video_id`',
      'You want to analyze existing video → analyze_video',
    ],
    goodExamples: [
      '`{ "prompt": "Ocean waves at sunset, cinematic" }`',
      'Timeout resume: response has `_meta.code: JOB_STILL_RUNNING` and `_meta.video_id` → call `get_video_status`',
      '`{ "prompt": "Morph", "first_frame_image": "a.jpg", "last_frame_image": "b.jpg" }`',
    ],
    badExamples: [
      'Treating JOB_STILL_RUNNING as failure — it is success with resume metadata',
      '`{ "prompt": "   " }` → INVALID_INPUT',
      'Polling get_video_status in the same turn without waiting → expect JOB_STILL_RUNNING again',
    ],
    failsWhen: [
      'INVALID_INPUT: empty prompt',
      'UNSAFE_PATH: save_path or image paths escaped sandbox',
      'UPSTREAM_REFUSED: policy, credits, or bad request',
      'JOB_FAILED: provider marked job failed',
    ],
    worksWith: ['get_video_status', 'generate_video_from_image'],
  }),

  generate_video_from_image: buildToolDescription({
    summary:
      'Narrow image-to-video wrapper: one `image` (first frame) + `prompt`. Fewer parameters → higher tool-call accuracy. ' +
      'For last-frame or reference images use generate_video.',
    useWhen: [
      'Single reference image + motion prompt is enough',
      'You want the smallest argument surface for image-to-video',
    ],
    notWhen: [
      'You need last_frame_image or reference_images[] → generate_video',
      'Checking job status → get_video_status',
    ],
    goodExamples: [
      '`{ "image": "start.png", "prompt": "Camera slowly zooms in" }`',
      'On timeout: same JOB_STILL_RUNNING + video_id resume as generate_video',
    ],
    badExamples: [
      '`{ "first_frame_image": "x.png" }` → wrong key; use `image`',
      'Passing video_id here → use get_video_status',
    ],
    failsWhen: [
      'INVALID_INPUT: image or prompt missing',
      'UNSAFE_PATH: image path escaped sandbox',
      'UPSTREAM_REFUSED / JOB_FAILED: same as generate_video',
    ],
    worksWith: ['generate_video', 'get_video_status'],
  }),

  get_video_status: buildToolDescription({
    summary:
      'Poll an async video job by id. Downloads and optionally saves when complete. ' +
      'Still running → success with `_meta.code: JOB_STILL_RUNNING` (not an error).',
    useWhen: [
      'generate_video returned JOB_STILL_RUNNING or you have a video_id from a prior call',
      'You want to check progress without resubmitting',
    ],
    notWhen: [
      'Starting a new generation → generate_video or generate_video_from_image',
      'You do not have a video_id yet',
    ],
    goodExamples: [
      '`{ "video_id": "vid_abc123" }`',
      '`{ "video_id": "vid_abc123", "save_path": "out/clip.mp4" }`',
      'Repeat until status completes or you accept partial progress from `_meta.progress`',
    ],
    badExamples: [
      '`{ "id": "vid_abc" }` → wrong key; use `video_id`',
      'Expecting instant completion on first poll for long jobs',
      'Treating JOB_STILL_RUNNING as tool failure',
    ],
    failsWhen: [
      'INVALID_INPUT: video_id missing',
      'UNSAFE_PATH: save_path escaped sandbox',
      'JOB_FAILED: provider marked job failed',
    ],
    worksWith: ['generate_video', 'generate_video_from_image'],
  }),

  rerank_documents: buildToolDescription({
    summary:
      'Re-order documents by relevance to a query using an OpenRouter reranker. Default: cohere/rerank-english-v3.0.',
    useWhen: [
      'You have a query and a list of text snippets to sort by relevance',
      'You will feed top results into chat_completion for grounded answers',
    ],
    notWhen: [
      'You need to fetch documents from the web → chat_completion with online or external retrieval first',
      'documents is empty or contains non-strings',
    ],
    goodExamples: [
      '`{ "query": "battery life", "documents": ["Doc A text...", "Doc B text..."] }`',
      '`{ "query": "...", "documents": [...], "model": "cohere/rerank-english-v3.0" }`',
    ],
    badExamples: [
      '`{ "documents": [] }` → INVALID_INPUT',
      '`{ "query": "x", "documents": [{ "text": "y" }] }` → elements must be strings',
      'Using rerank output as model messages without extracting text fields',
    ],
    failsWhen: [
      'INVALID_INPUT: query missing, documents empty, or non-string elements',
      'MODEL_NOT_FOUND: reranker slug invalid',
      'UPSTREAM_HTTP: provider error',
    ],
    worksWith: ['search_models', 'chat_completion'],
  }),

  health_check: buildToolDescription({
    summary:
      'Verify API key, OpenRouter reachability, cached model count, and server/protocol versions. No arguments.',
    useWhen: [
      'Startup / ops probe before other tools',
      'You need `{ ok, api_key_valid }` without triggering generation costs',
    ],
    notWhen: [
      'You need to test a specific model quality → use chat_completion with a tiny prompt',
      'You expect isError on bad API key — this tool always returns structured payload',
    ],
    goodExamples: [
      '`{}` — empty args',
      'Branch on `structuredContent.api_key_valid === false` to prompt re-auth',
    ],
    badExamples: [
      'Passing model or prompt — ignored; not a chat tool',
      'Expecting isError: true on failure — check `ok` field instead',
    ],
    failsWhen: [
      'Never returns isError — always `{ ok, api_key_valid, ... }` for programmatic branching',
    ],
    worksWith: ['every other tool (run once at startup)'],
  }),
};
