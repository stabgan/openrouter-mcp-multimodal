<p align="center">
  <img src="assets/logo.png" alt="OpenRouter MCP Multimodal" width="200" height="200" />
</p>

<h1 align="center">OpenRouter MCP Multimodal Server</h1>

<p align="center">
  <strong>The all-in-one MCP server for 300+ LLMs — text, vision, audio, and video in a single package.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@stabgan/openrouter-mcp-multimodal"><img src="https://img.shields.io/npm/v/@stabgan/openrouter-mcp-multimodal.svg?label=npm&color=cb3837&logo=npm" alt="npm version" /></a>
  <a href="https://hub.docker.com/r/stabgan/openrouter-mcp-multimodal"><img src="https://img.shields.io/docker/v/stabgan/openrouter-mcp-multimodal/latest?label=docker&color=2496ed&logo=docker&logoColor=white" alt="Docker version" /></a>
  <a href="https://github.com/stabgan/openrouter-mcp-multimodal/actions/workflows/publish.yml"><img src="https://github.com/stabgan/openrouter-mcp-multimodal/actions/workflows/publish.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.apache.org/licenses/LICENSE-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="Apache 2.0" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A518-43853d?logo=node.js&logoColor=white" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@stabgan/openrouter-mcp-multimodal"><img src="https://img.shields.io/npm/dt/@stabgan/openrouter-mcp-multimodal.svg?label=npm%20downloads&color=cb3837&logo=npm" alt="npm downloads" /></a>
  <a href="https://www.npmjs.com/package/@stabgan/openrouter-mcp-multimodal"><img src="https://img.shields.io/npm/dm/@stabgan/openrouter-mcp-multimodal.svg?label=monthly&color=cb3837&logo=npm" alt="npm monthly" /></a>
  <a href="https://hub.docker.com/r/stabgan/openrouter-mcp-multimodal"><img src="https://img.shields.io/docker/pulls/stabgan/openrouter-mcp-multimodal.svg?label=docker%20pulls&color=2496ed&logo=docker&logoColor=white" alt="Docker pulls" /></a>
  <a href="https://smithery.ai/servers/stabgan/openrouter-mcp-multimodal"><img src="https://smithery.ai/badge/stabgan/openrouter-mcp-multimodal" alt="Smithery" /></a>
  <a href="https://github.com/stabgan/openrouter-mcp-multimodal/stargazers"><img src="https://img.shields.io/github/stars/stabgan/openrouter-mcp-multimodal.svg?style=social" alt="GitHub stars" /></a>
  <a href="https://github.com/stabgan/openrouter-mcp-multimodal/network/members"><img src="https://img.shields.io/github/forks/stabgan/openrouter-mcp-multimodal.svg?style=social" alt="GitHub forks" /></a>
</p>
<p align="center">
  <sub>4,700+ installs across npm + Docker Hub &middot; ~950 npm installs/month and accelerating</sub>
</p>

<p align="center">
  <a href="#one-click-install">Install</a> &middot;
  <a href="#tools">Tools</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#configuration">Config</a> &middot;
  <a href="#usage-examples">Examples</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="./CHANGELOG.md">Changelog</a>
</p>

---
[![Verified on MseeP](https://mseep.ai/badge.svg)](https://mseep.ai/app/8f27d6d4-0877-4b86-b377-8a33f451e755)

Access 300+ LLMs — Claude, Gemini, GPT, Llama, Qwen, Grok, and more — through [OpenRouter](https://openrouter.ai) via the [Model Context Protocol](https://modelcontextprotocol.io). Analyze images, audio, and video. Generate images, speech, music, and video (Veo 3.1, Sora 2 Pro, Seedance, Wan). Chat with any model. Works with **Claude Desktop**, **Cursor**, **Kiro**, **VS Code**, **Windsurf**, **Cline**, and any MCP-compatible client. Every tool returns structured `_meta.code` errors so MCP clients can switch on failure modes without parsing strings.



## One-Click Install

<table>
<tr><td><strong>Kiro</strong></td><td><a href="https://kiro.dev/launch/mcp/add?name=openrouter&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40stabgan%2Fopenrouter-mcp-multimodal%22%5D%2C%22env%22%3A%7B%22OPENROUTER_API_KEY%22%3A%22sk-or-v1-...%22%7D%2C%22disabled%22%3Afalse%2C%22autoApprove%22%3A%5B%5D%7D"><img src="https://img.shields.io/badge/Add_to-Kiro-232F3E?style=for-the-badge&logo=amazonaws&logoColor=white" alt="Add to Kiro" /></a></td></tr>
<tr><td><strong>Cursor</strong></td><td><a href="https://cursor.com/en/install-mcp?name=openrouter&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBzdGFiZ2FuL29wZW5yb3V0ZXItbWNwLW11bHRpbW9kYWwiXSwiZW52Ijp7Ik9QRU5ST1VURVJfQVBJX0tFWSI6InNrLW9yLXYxLS4uLiJ9fQ%3D%3D"><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" /></a></td></tr>
<tr><td><strong>VS Code</strong></td><td><a href="https://insiders.vscode.dev/redirect/mcp/install?name=openrouter&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40stabgan%2Fopenrouter-mcp-multimodal%22%5D%2C%22env%22%3A%7B%22OPENROUTER_API_KEY%22%3A%22sk-or-v1-...%22%7D%7D"><img src="https://img.shields.io/badge/Add_to-VS_Code-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Add to VS Code" /></a></td></tr>
<tr><td><strong>VS Code Insiders</strong></td><td><a href="https://insiders.vscode.dev/redirect/mcp/install?name=openrouter&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40stabgan%2Fopenrouter-mcp-multimodal%22%5D%2C%22env%22%3A%7B%22OPENROUTER_API_KEY%22%3A%22sk-or-v1-...%22%7D%7D&quality=insiders"><img src="https://img.shields.io/badge/Add_to-VS_Code_Insiders-24bfa5?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Add to VS Code Insiders" /></a></td></tr>
<tr><td><strong>Claude Desktop</strong></td><td><a href="#option-1-npx-no-install">Install Guide</a> — Add to <code>claude_desktop_config.json</code></td></tr>
<tr><td><strong>Windsurf</strong></td><td><a href="#option-1-npx-no-install">Install Guide</a> — Add to <code>~/.codeium/windsurf/mcp_config.json</code></td></tr>
<tr><td><strong>Cline</strong></td><td><a href="#option-1-npx-no-install">Install Guide</a> — Add via Cline MCP settings</td></tr>
<tr><td><strong>Smithery</strong></td><td><code>npx -y @smithery/cli install @stabgan/openrouter-mcp-multimodal --client claude</code></td></tr>
</table>

> After clicking, the target client opens a confirmation prompt. You'll need to paste your `OPENROUTER_API_KEY` — the deeplink ships a placeholder so no secrets end up in shared links.

<!--
Install-link audit (2026-04-20, round 4 — HTTPS redirectors only):
  GitHub Markdown strips non-HTTPS schemes (cursor://, vscode:) from href attributes
  and rewrites them to cursor.sh / nothing. The only deeplinks that survive GitHub's
  sanitizer are HTTPS URLs. Fortunately both Cursor and VS Code publish official
  HTTPS redirector endpoints that hand off to the IDE's native protocol handler:

  - Kiro:    https://kiro.dev/launch/mcp/add?name=<name>&config=<url-encoded JSON>
  - Cursor:  https://cursor.com/en/install-mcp?name=<name>&config=<base64>
             (config excludes `name`; badge is cursor.com/deeplink/mcp-install-dark.svg)
  - VS Code: https://insiders.vscode.dev/redirect/mcp/install?name=<name>&config=<urlenc JSON>
             (config excludes `name`; append &quality=insiders for Insiders)

  Earlier rounds used cursor://anysphere.cursor-deeplink/... and vscode:mcp/install?...
  — both got stripped by GitHub and rendered as broken redirects to cursor.sh or a
  camo.githubusercontent.com image-proxy URL. Pattern confirmed against
  github/github-mcp-server and modelcontextprotocol/servers READMEs.

  Regenerate with: node scripts/make-install-links.mjs
-->

## Why This One?

| Feature | Status |
| :--- | :--- |
| Text chat with 300+ models | ✅ |
| Image analysis (vision) | ✅ Native with sharp optimization |
| Audio analysis | ✅ Transcription + analysis, base64 auto-encoded |
| Audio generation | ✅ Conversational, speech, and music with format auto-detection |
| Image generation | ✅ Path-sandboxed disk output |
| **Video understanding** | ✅ **v3** — mp4, mpeg, mov, webm from files, URLs, or data URLs |
| **Video generation** | ✅ **v3** — Veo 3.1 / Sora 2 Pro / Seedance / Wan via async API with progress notifications |
| **Response caching** | ✅ **v4.5** — `X-OpenRouter-Cache` passthrough, zero tokens billed on hit, 80–300ms latency |
| **Web search plugin** | ✅ **v4.5** — `online: true` on `chat_completion` injects OpenRouter's Exa-backed plugin |
| **Rerank** | ✅ **v4.5** — `rerank_documents` tool against `/rerank` (Cohere, Fireworks) |
| **Health check** | ✅ **v4.5** — `health_check` verifies API key + OpenRouter reachability |
| **Reasoning tokens** | ✅ **v4.5** — passthrough of DeepSeek R1 / Gemini Thinking / Opus 4.7 traces on `_meta.reasoning` |
| **MCP 2025-06-18 spec** | ✅ **v4.5** — structured outputs (`outputSchema`), progress notifications, `title` + `openWorldHint` |
| Auto image resize + compress | ✅ Configurable (defaults 800px max, JPEG 80%) |
| Model search + validation | ✅ Filter by vision / audio / video modality |
| Free model support | ✅ Default: free Nemotron VL |
| Docker support | ✅ Multi-arch (amd64 + arm64), ~345 MB Alpine |
| Retry-After + jitter | ✅ Honors `Retry-After` header, avoids thundering herd |
| IPv4 + IPv6 SSRF blocklist | ✅ Covers mapped, compat, multicast, 6to4, Teredo, ORCHID |
| Structured error taxonomy | ✅ Closed `_meta.code` so clients can switch on failure modes |
| Reasoning-model awareness | ✅ Detects `max_tokens` cutoff during CoT, guides the caller |
| MCP 2025 tool annotations | ✅ `readOnlyHint` / `destructiveHint` / `idempotentHint` on every tool |

## Tools

| Tool | Description |
| :--- | :--- |
| `chat_completion` | Send messages to any OpenRouter model. Detects reasoning-model cutoffs. Supports **provider routing** (`quantizations`, `ignore`, `sort`, `order`, `require_parameters`, `data_collection`, `allow_fallbacks`), **model suffixes** (`:nitro` for fastest, `:floor` for cheapest, `:exacto` for Auto Exacto tool-calling), **response caching** (`cache`, `cache_ttl`, `cache_clear`), **reasoning passthrough** (`include_reasoning`), and **web search** (`online`, `web_max_results`). |
| `analyze_image` | Analyze images from local files, URLs, or data URIs. Auto-optimized with sharp. Optional `cache_input: true` attaches `cache_control: ephemeral` for Anthropic / Gemini 2.5+ prompt caching. |
| `analyze_audio` | Analyze/transcribe audio (WAV, MP3, FLAC, OGG, etc.) from files, URLs, or data URIs. Optional `cache_input: true` for prompt caching. |
| `analyze_video` | Analyze/transcribe video (mp4, mpeg, mov, webm) from files, URLs, or data URIs. Optional `cache_input: true` for prompt caching. |
| `generate_image` | Generate images from text prompts. Supports `aspect_ratio` (14 values), `image_size` (0.5K–4K), and `max_tokens`. Optional path-sandboxed disk save. |
| `generate_audio` | Generate audio from text. Auto-detects format, wraps raw PCM in WAV. |
| `generate_video` | Generate video via OpenRouter's async API (Veo 3.1 / Sora 2 Pro / Seedance / Wan). Submits, polls, downloads, saves. Emits MCP `notifications/progress` when the client sends a `progressToken`. |
| `generate_video_from_image` | Image-to-video wrapper around `generate_video`. Narrower schema, higher tool-call hit rate. |
| `get_video_status` | Resume polling a `generate_video` job by id. Download + save when complete. |
| `rerank_documents` | Rerank candidate documents against a query via OpenRouter's `/rerank` endpoint. Supports Cohere and Fireworks rerankers. |
| `search_models` | Search/filter models by name, provider, or capabilities (vision / audio / video). Paginated via `offset` / `next_offset` / `has_more` / `total`. |
| `get_model_info` | Get pricing, context length, and capabilities for any model. |
| `validate_model` | Check if a model ID exists on OpenRouter. |
| `health_check` | Verify API-key validity, OpenRouter reachability, and return server + protocol versions. |

> All error responses carry `_meta.code` from a closed taxonomy: `INVALID_INPUT` · `UNSAFE_PATH` · `UPSTREAM_HTTP` · `UPSTREAM_TIMEOUT` · `UPSTREAM_REFUSED` · `UNSUPPORTED_FORMAT` · `RESOURCE_TOO_LARGE` · `ZDR_INCOMPATIBLE` · `MODEL_NOT_FOUND` · `JOB_FAILED` · `JOB_STILL_RUNNING` · `INTERNAL`

## Quick Start

### Prerequisites

Get a free API key from [openrouter.ai/keys](https://openrouter.ai/keys).

### Option 1: npx (no install)

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "npx",
      "args": ["-y", "@stabgan/openrouter-mcp-multimodal"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      }
    }
  }
}
```

### Option 2: Docker

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "OPENROUTER_API_KEY=sk-or-v1-...",
        "stabgan/openrouter-mcp-multimodal:latest"
      ]
    }
  }
}
```

### Option 3: Global install

```bash
npm install -g @stabgan/openrouter-mcp-multimodal
```

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "openrouter-multimodal",
      "env": { "OPENROUTER_API_KEY": "sk-or-v1-..." }
    }
  }
}
```

### Option 4: Smithery

```bash
npx -y @smithery/cli install @stabgan/openrouter-mcp-multimodal --client claude
```

## Configuration

<details>
<summary><strong>Environment variables</strong> (click to expand)</summary>

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `OPENROUTER_API_KEY` | Yes | — | Your OpenRouter API key |
| `OPENROUTER_DEFAULT_MODEL` | No | `nvidia/nemotron-nano-12b-v2-vl:free` | Default model for chat + analyze tools |
| `DEFAULT_MODEL` | No | — | Alias for above |
| `OPENROUTER_MAX_TOKENS` | No | — | Default `max_tokens` for `chat_completion` when not set in the request. Useful on low-credit / free-tier accounts to avoid the full-context-window reservation. |
| `OPENROUTER_PROVIDER_QUANTIZATIONS` | No | — | CSV. Filter providers by quantization (e.g. `fp16,int8`). |
| `OPENROUTER_PROVIDER_IGNORE` | No | — | CSV. Exclude these provider slugs (e.g. `openai,anthropic`). |
| `OPENROUTER_PROVIDER_SORT` | No | — | `price` / `throughput` / `latency`. |
| `OPENROUTER_PROVIDER_ORDER` | No | — | JSON array or CSV of provider IDs (e.g. `["meta-llama","google"]`). |
| `OPENROUTER_PROVIDER_REQUIRE_PARAMETERS` | No | — | `true` / `false`. Only use providers supporting every request parameter. |
| `OPENROUTER_PROVIDER_DATA_COLLECTION` | No | — | `allow` / `deny`. Opt out of providers that log request data. |
| `OPENROUTER_PROVIDER_ALLOW_FALLBACKS` | No | — | `true` / `false`. |
| `OPENROUTER_CACHE_RESPONSES` | No | — | `1` / `true`. Enable response caching server-wide. Sends `X-OpenRouter-Cache: true` on chat + analyze_* calls unless overridden per-request with `cache: false`. Zero tokens billed on hits. |
| `OPENROUTER_INCLUDE_REASONING` | No | — | `1` / `true`. Enable reasoning tokens passthrough server-wide for DeepSeek R1 / Gemini Thinking / Opus 4.7. Adds `_meta.reasoning` to `chat_completion` responses. |
| `OPENROUTER_MODEL_CACHE_TTL_MS` | No | `3600000` | Model cache TTL (ms) |
| `OPENROUTER_IMAGE_MAX_DIMENSION` | No | `800` | Longest edge for resize (px) |
| `OPENROUTER_IMAGE_JPEG_QUALITY` | No | `80` | JPEG quality (1–100) |
| `OPENROUTER_IMAGE_FETCH_TIMEOUT_MS` | No | `30000` | Image URL timeout |
| `OPENROUTER_IMAGE_MAX_DOWNLOAD_BYTES` | No | `26214400` | Image URL size cap (~25 MB) |
| `OPENROUTER_IMAGE_MAX_REDIRECTS` | No | `8` | Image URL redirect cap |
| `OPENROUTER_IMAGE_MAX_DATA_URL_BYTES` | No | `20971520` | Image data URL size cap (~20 MB) |
| `OPENROUTER_AUDIO_FETCH_TIMEOUT_MS` | No | `30000` | Audio URL timeout |
| `OPENROUTER_AUDIO_MAX_DOWNLOAD_BYTES` | No | `26214400` | Audio URL size cap (~25 MB) |
| `OPENROUTER_AUDIO_MAX_REDIRECTS` | No | `8` | Audio URL redirect cap |
| `OPENROUTER_AUDIO_MAX_DATA_URL_BYTES` | No | `20971520` | Audio data URL size cap |
| `OPENROUTER_DEFAULT_VIDEO_MODEL` | No | `google/gemini-2.5-flash` | Default for `analyze_video` |
| `OPENROUTER_DEFAULT_VIDEO_GEN_MODEL` | No | `google/veo-3.1` | Default for `generate_video` |
| `OPENROUTER_VIDEO_FETCH_TIMEOUT_MS` | No | `60000` | Video URL timeout |
| `OPENROUTER_VIDEO_MAX_DOWNLOAD_BYTES` | No | `104857600` | Video URL size cap (~100 MB) |
| `OPENROUTER_VIDEO_MAX_REDIRECTS` | No | `8` | Video URL redirect cap |
| `OPENROUTER_VIDEO_MAX_DATA_URL_BYTES` | No | `104857600` | Video data URL size cap |
| `OPENROUTER_VIDEO_POLL_INTERVAL_MS` | No | `15000` | Async video poll cadence |
| `OPENROUTER_VIDEO_MAX_WAIT_MS` | No | `600000` | Max wait before returning a resumable handle |
| `OPENROUTER_VIDEO_GEN_MAX_BYTES` | No | `268435456` | Generated video download cap (~256 MB) |
| `OPENROUTER_VIDEO_INLINE_MAX_BYTES` | No | `10485760` | Inline video ceiling (~10 MB) |
| `OPENROUTER_OUTPUT_DIR` | No | `process.cwd()` | Sandbox root for `save_path` |
| `OPENROUTER_ALLOW_UNSAFE_PATHS` | No | — | `1` disables the sandbox |
| `OPENROUTER_LOG_LEVEL` | No | `info` | `error` / `warn` / `info` / `debug` |

</details>

### Security notes

- **Analyze tools** can read local files and fetch HTTP(S) URLs. URL fetches block private/link-local/reserved IPv4 and IPv6 targets (SSRF mitigation) and cap response size.
- **Generate tools** write to disk through a path sandbox: `save_path` is resolved against `OPENROUTER_OUTPUT_DIR` and any traversal attempt is rejected. Override with `OPENROUTER_ALLOW_UNSAFE_PATHS=1`.
- **IPv6 SSRF blocklist** covers loopback, unspecified, IPv4-mapped, IPv4-compatible, link-local, site-local, ULA, multicast, documentation, Teredo, ORCHID, and 6to4 of private IPv4.

## Usage Examples

```
# Chat
Use chat_completion to explain quantum computing in simple terms.

# Chat with provider routing — prefer cheapest provider, exclude OpenAI, opt out of data collection
Use chat_completion with model "anthropic/claude-3.5-sonnet", prompt "Summarize this",
provider { sort: "price", ignore: ["openai"], data_collection: "deny" }

# Chat with :nitro variant for faster response
Use chat_completion with model "openai/gpt-4o:nitro", prompt "Reason step-by-step about this problem"

# Chat with :floor variant for cheapest provider of the requested model
Use chat_completion with model "mistralai/mistral-7b-instruct:floor", prompt "Quick check"

# Chat with response caching + reasoning passthrough (v4.5)
Use chat_completion with model "deepseek/deepseek-r1", prompt "Prove sqrt(2) is irrational",
cache: true, cache_ttl: 3600, include_reasoning: true
# → response.meta.cache = { status: "hit" | "miss", age, ttl }
# → response.meta.reasoning = "<upstream reasoning trace>"

# Chat with web search plugin (v4.5)
Use chat_completion with model "openai/gpt-4o", prompt "What shipped in OpenRouter last week?",
online: true, web_max_results: 5

# Rerank documents against a query (v4.5)
Use rerank_documents with query "best practices for MCP server auth",
documents: ["doc A text...", "doc B text...", "doc C text..."], top_n: 3

# Generate video from an image (v4.5)
Use generate_video_from_image with image "./frame.png", prompt "zoom out slowly",
model "google/veo-3.1", save to ./clip.mp4

# Health check (v4.5)
Use health_check
# → { ok: true, server_version: "4.5.0", protocol_version: "2025-06-18", api_key_valid: true, models_cached: 312 }

# Vision
Use analyze_image on /path/to/photo.jpg and tell me what you see.

# Audio transcription
Use analyze_audio on /path/to/recording.mp3 to transcribe it.

# Video understanding
Use analyze_video on /path/to/clip.mp4 — what happens at 00:15?

# Generate audio
Use generate_audio with prompt "Explain neural networks" and voice "alloy", save to ./response.wav

# Generate music
Use generate_audio with model "google/lyria-3-clip-preview" and prompt "upbeat jazz piano trio"

# Generate image
Use generate_image with prompt "a cat astronaut on mars", aspect_ratio "16:9", image_size "1K", save to ./cat.png

# Generate video
Use generate_video with model "google/veo-3.1", prompt "a calm river at sunrise",
resolution 720p, duration 4, save to ./river.mp4

# Resume a video job
Use get_video_status with video_id "vid_abc123" and save_path "./river.mp4"
```

## Architecture

```
src/
├── index.ts                    # Entry, env validation, graceful shutdown
├── tool-handlers.ts            # 14 tools (annotated) + dispatch
├── model-cache.ts              # TTL + in-flight coalescing
├── openrouter-api.ts           # REST client (chat + /videos)
├── errors.ts                   # Closed ErrorCode enum
├── logger.ts                   # JSON-line structured logger
└── tool-handlers/
    ├── fetch-utils.ts          # SSRF, bounded fetch, data-URL parser
    ├── openrouter-errors.ts    # SDK/HTTP → ErrorCode classifier
    ├── completion-utils.ts     # Reasoning-model cutoff detection
    ├── path-safety.ts          # save_path sandbox
    ├── chat-completion.ts      # Text + multimodal chat
    ├── analyze-image.ts        # Vision analysis
    ├── analyze-audio.ts        # Audio transcription
    ├── analyze-video.ts        # Video understanding
    ├── generate-image.ts       # Image generation
    ├── generate-audio.ts       # Audio generation + streaming
    ├── generate-video.ts       # Video generation (async)
    ├── image-utils.ts          # Sharp optimization, MIME sniffing
    ├── audio-utils.ts          # Audio format detection
    ├── video-utils.ts          # Video format detection
    ├── search-models.ts        # Model search
    ├── get-model-info.ts       # Model detail lookup
    └── validate-model.ts       # Model existence check
```

## Design Principles & Research

v4.5.0's design draws from three threads of research and industry guidance. Rather than building in isolation, every feature ties to a cited source so decisions can be re-examined later.

### MCP-first design principles

We follow [Phil Schmid's production guide for MCP servers](https://www.philschmid.de/mcp-best-practices) (Jan 2026), which argues that an MCP server is "a user interface for AI agents, not a REST API wrapper":

- **Outcomes, not operations.** Our tools like `analyze_image` and `generate_video` encapsulate a whole workflow (fetch, validate, invoke, save) rather than exposing raw OpenRouter primitives.
- **Flattened arguments.** Top-level primitives with enums (`aspect_ratio`, `image_size`), no deeply nested configuration blobs. The one nested object (`provider`) is required by OpenRouter's routing schema.
- **Descriptions are context.** Every tool description includes "Fails when:" and "Works with:" sections (see next section for the research backing).
- **Curated surface.** 14 tools total. Each is a distinct outcome; no "helper" tools that exist only for internal composition.

Apigene's ["12 Rules for Production MCP Deployment"](https://apigene.ai/blog/mcp-best-practices) (March 2026) guided the error-handling posture: structured errors with `suggestions` and `retry_after_seconds` on `_meta` beat raw error strings the agent has to interpret.

### MCP 2025-06-18 spec compliance

- **Structured outputs.** `validate_model`, `get_model_info`, `search_models`, `rerank_documents`, and `health_check` emit [`structuredContent` with `outputSchema`](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#output-schema), per §5.2.6-7. Agents can validate responses typefully.
- **Progress notifications.** `generate_video` emits [`notifications/progress`](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress) on every poll tick when the client passes a `progressToken` in `_meta`. Progress values are guaranteed strictly monotonic per spec.
- **Tool annotations.** Every tool carries `title` + `readOnlyHint` + `destructiveHint` + `idempotentHint` + `openWorldHint` so clients can render appropriate UI affordances.

### Research-backed tool-design decisions

These papers shaped specific v4.5.0 choices:

| Finding | Source | How it shaped v4.5.0 |
| :--- | :--- | :--- |
| Failure-mode docs and inter-tool relationships measurably improve tool-selection accuracy | [Schlapbach, *Convergence of SGD & MCP*](https://arxiv.org/abs/2602.18764) (Feb 2026) | Every tool description has explicit "Fails when:" (ErrorCode triggers) and "Works with:" (related tools). |
| Tool-call success drops with parameter count and schema complexity | [Fu et al., *ROSBag MCP Server*](https://arxiv.org/abs/2511.03497) (Nov 2025) | `generate_video_from_image` is a narrower image-to-video wrapper around `generate_video` — fewer params, higher hit rate. |
| Indirect prompt injection via tool-returned content is a real attack vector | [Zhao et al., *ClawGuard*](https://arxiv.org/abs/2604.11790) (Apr 2026) · [Yu et al., *Defense via Tool Result Parsing*](https://arxiv.org/abs/2601.04795) (Jan 2026) | `analyze_image` / `analyze_audio` / `analyze_video` tag their output `_meta.content_is_untrusted: true`. Downstream agents know to treat that text as data, not instructions. |
| Provider-level tool-calling variance is large and persists across providers for the same model | [OpenRouter Auto Exacto announcement](https://openrouter.ai/announcements/auto-exacto) (Mar 2026) | `chat_completion` documents the `:exacto` model suffix alongside `:nitro` / `:floor`. 80-88% error reduction on top tool-calling models. |
| LLM JSON defects compound at scale | [OpenRouter Response Healing](https://openrouter.ai/announcements/response-healing-reduce-json-defects-by-80percent) (Dec 2025) | Structured outputs + outputSchema declarations give clients a parseable contract. (Response-healing plugin itself is opt-in on OpenRouter's side.) |
| MCP servers are vulnerable to preference-manipulation and tool-poisoning attacks | [Wang et al., *MPMA*](https://arxiv.org/abs/2505.11154) (May 2025) · [Turgut & Gümüş, *CASCADE*](https://arxiv.org/abs/2604.17125) (Apr 2026) | Tool descriptions audited for injection surface; audit logging (`logger.audit()`) captures every paid-op invocation with a prompt preview for forensics. |

### OpenRouter platform parity

v4.5.0 surfaces platform features shipped between Q4 2025 and Q2 2026:

- [Response caching via `X-OpenRouter-Cache`](https://openrouter.ai/announcements/response-caching) (Apr 2026): zero tokens billed on identical request cache hits, 80-300ms latency.
- [Web search plugin](https://openrouter.ai/announcements/introducing-web-search-via-the-api) (Jan 2025): Exa-backed, enabled via `online: true`.
- [Reasoning tokens](https://openrouter.ai/announcements/reasoning-tokens-for-thinking-models) (Jan 2025): DeepSeek R1 / Gemini Thinking / Opus 4.7 chain-of-thought via `include_reasoning: true`.
- [Auto Exacto](https://openrouter.ai/announcements/auto-exacto) (Mar 2026): on-by-default for tool-calling; `:exacto` suffix for all other requests.
- [Rerank endpoint](https://openrouter.ai/announcements/april-release-spotlight) (Apr 2026): Cohere + Fireworks via the new `rerank_documents` tool.
- [Prompt caching with `cache_control`](https://openrouter.ai/docs/guides/best-practices/prompt-caching): Anthropic Claude 10x / Gemini 2.5+ 4x savings on repeated input media via `cache_input: true` on analyze_* tools.
- [Zero completion token insurance](https://openrouter.ai/announcements/never-pay-for-empty-ai-responses-again) (Mar 2025): automatic, no opt-in needed.

### Security posture

- **Path sandbox.** All file writes (`save_path`) and reads (`input_images`, frame images) go through `resolveSafeOutputPath` / `resolveSafeInputPath`, which reject traversal escapes. Legacy bypass: `OPENROUTER_ALLOW_UNSAFE_PATHS=1`.
- **SSRF blocklist.** Loopback, private, link-local, multicast, 6to4, Teredo, ORCHID, and IPv4-mapped IPv6 all rejected at the fetch layer.
- **Audit logging.** `logger.audit()` emits a JSON line at level=audit for every `generate_video`, `generate_audio`, and `generate_image` call. Bypasses `OPENROUTER_LOG_LEVEL` so unintended spend is always traceable. 80-char prompt preview is the hard PII boundary.
- **Structured errors.** Closed `_meta.code` taxonomy means agents switch on failure modes without regex-parsing free text. Rate-limit errors include `retry_after_seconds` derived from `Retry-After` headers.
- **No credential leakage.** `OPENROUTER_API_KEY` is read once at startup, passed to the SDK, and never echoed in logs, tool responses, or error messages. Fatal-error logging whitelists fields explicitly (name / message / trimmed stack) — no raw error objects. Verified by an independent bug-hunter audit (Apr 2026).

## Development

```bash
git clone https://github.com/stabgan/openrouter-mcp-multimodal.git
cd openrouter-mcp-multimodal
npm install
cp .env.example .env  # Add your API key
npm run build
npm start
```

```bash
npm test                    # 163 unit tests, <1s
npm run test:integration    # Live API tests
npm run lint
node scripts/live-e2e.mjs  # 16 live E2E scenarios
```

## Upgrading from v2

v3 is **additive** — no tool schemas or env vars were removed.

- Three new tools: `analyze_video`, `generate_video`, `get_video_status`
- Structured `_meta.code` on every error response (text messages preserved)
- `save_path` sandboxed by default — set `OPENROUTER_OUTPUT_DIR` or `OPENROUTER_ALLOW_UNSAFE_PATHS=1`
- Reasoning-model awareness: `content: null` + `finish_reason: length` now returns `INVALID_INPUT` with a preview instead of empty string
- IPv6 SSRF coverage extended to mapped, compat, multicast, 6to4, Teredo, ORCHID

## Compatibility

Works with any MCP client: [Kiro](https://kiro.dev) · [Claude Desktop](https://claude.ai/download) · [Cursor](https://cursor.sh) · [Windsurf](https://codeium.com/windsurf) · [Cline](https://github.com/cline/cline) · any MCP-compatible client.

## License

Apache 2.0. See [LICENSE](./LICENSE). v1.0.0 through v3.2.0 were released under MIT; v4.0.0 relicensed to Apache 2.0 (Apache 2.0 is a permissive superset of MIT with explicit patent grant).

## Contributing

Issues and PRs welcome. Please open an issue first for major changes.
