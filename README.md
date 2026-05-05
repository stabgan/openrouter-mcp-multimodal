<p align="center">
  <img src="assets/logo.png" alt="OpenRouter MCP Multimodal" width="128" height="128" />
</p>

<h1 align="center">OpenRouter MCP Multimodal Server</h1>

<p align="center">
  <strong>The only MCP server that does text + image + audio + video analysis AND generation in one package.<br/>Connect Claude Desktop, Cursor, Kiro, VS Code, Windsurf, or Cline to 300+ LLMs via OpenRouter.</strong>
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
  <a href="#install">Install</a> &middot;
  <a href="#tools">Tools</a> &middot;
  <a href="#usage-examples">Examples</a> &middot;
  <a href="#configuration">Config</a> &middot;
  <a href="./CHANGELOG.md">Changelog</a>
</p>

---

[![Verified on MseeP](https://mseep.ai/badge.svg)](https://mseep.ai/app/8f27d6d4-0877-4b86-b377-8a33f451e755)

## Install

```bash
npx -y @stabgan/openrouter-mcp-multimodal  # that's it — needs OPENROUTER_API_KEY env var
```

Get a free API key → [openrouter.ai/keys](https://openrouter.ai/keys)

### One-Click Install

<table>
<tr><td><strong>Kiro</strong></td><td><a href="https://kiro.dev/launch/mcp/add?name=openrouter&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40stabgan%2Fopenrouter-mcp-multimodal%22%5D%2C%22env%22%3A%7B%22OPENROUTER_API_KEY%22%3A%22sk-or-v1-...%22%7D%2C%22disabled%22%3Afalse%2C%22autoApprove%22%3A%5B%5D%7D"><img src="https://img.shields.io/badge/Add_to-Kiro-232F3E?style=for-the-badge&logo=amazonaws&logoColor=white" alt="Add to Kiro" /></a></td></tr>
<tr><td><strong>Cursor</strong></td><td><a href="https://cursor.com/en/install-mcp?name=openrouter&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBzdGFiZ2FuL29wZW5yb3V0ZXItbWNwLW11bHRpbW9kYWwiXSwiZW52Ijp7Ik9QRU5ST1VURVJfQVBJX0tFWSI6InNrLW9yLXYxLS4uLiJ9fQ%3D%3D"><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" /></a></td></tr>
<tr><td><strong>VS Code</strong></td><td><a href="https://insiders.vscode.dev/redirect/mcp/install?name=openrouter&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40stabgan%2Fopenrouter-mcp-multimodal%22%5D%2C%22env%22%3A%7B%22OPENROUTER_API_KEY%22%3A%22sk-or-v1-...%22%7D%7D"><img src="https://img.shields.io/badge/Add_to-VS_Code-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Add to VS Code" /></a></td></tr>
<tr><td><strong>VS Code Insiders</strong></td><td><a href="https://insiders.vscode.dev/redirect/mcp/install?name=openrouter&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40stabgan%2Fopenrouter-mcp-multimodal%22%5D%2C%22env%22%3A%7B%22OPENROUTER_API_KEY%22%3A%22sk-or-v1-...%22%7D%7D&quality=insiders"><img src="https://img.shields.io/badge/Add_to-VS_Code_Insiders-24bfa5?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Add to VS Code Insiders" /></a></td></tr>
<tr><td><strong>Claude Desktop</strong></td><td><a href="#manual-config">Manual config</a> — Add to <code>claude_desktop_config.json</code></td></tr>
<tr><td><strong>Windsurf</strong></td><td><a href="#manual-config">Manual config</a> — Add to <code>~/.codeium/windsurf/mcp_config.json</code></td></tr>
<tr><td><strong>Cline</strong></td><td><a href="#manual-config">Manual config</a> — Add via Cline MCP settings</td></tr>
<tr><td><strong>Smithery</strong></td><td><code>npx -y @smithery/cli install @stabgan/openrouter-mcp-multimodal --client claude</code></td></tr>
</table>

> After clicking, the target client opens a confirmation prompt. Paste your `OPENROUTER_API_KEY` — the deeplink ships a placeholder so no secrets end up in shared links.

### Manual Config

<details>
<summary><strong>npx (recommended)</strong></summary>

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
</details>

<details>
<summary><strong>Docker</strong></summary>

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
</details>

<details>
<summary><strong>Global install</strong></summary>

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
</details>

## Why This One?

| Capability | This server | Others |
| :--- | :---: | :---: |
| Text chat with 300+ models | ✅ | ✅ |
| Image analysis (vision) | ✅ sharp-optimized | some |
| Audio analysis + generation | ✅ | ❌ |
| **Video understanding** (mp4/mov/webm) | ✅ | ❌ |
| **Video generation** (Veo 3.1, Sora 2 Pro) | ✅ | ❌ |
| Response caching (zero tokens on hit) | ✅ | ❌ |
| Web search, rerank, health check | ✅ | ❌ |
| MCP 2025-06-18 spec (structured outputs, progress) | ✅ | ❌ |

## Tools

| Tool | What it does |
| :--- | :--- |
| `chat_completion` | Send messages to any model. Supports provider routing, model suffixes (`:nitro`, `:floor`, `:exacto`), response caching, reasoning passthrough, and web search. |
| `analyze_image` | Analyze images from local files, URLs, or data URIs. Auto-optimized with sharp. |
| `analyze_audio` | Transcribe/analyze audio (WAV, MP3, FLAC, OGG) from files, URLs, or data URIs. |
| `analyze_video` | Analyze video (mp4, mpeg, mov, webm) from files, URLs, or data URIs. |
| `generate_image` | Generate images with aspect ratio control and optional path-sandboxed disk save. |
| `generate_audio` | Generate speech or music. Auto-detects format, wraps raw PCM in WAV. |
| `generate_video` | Generate video via async API (Veo 3.1 / Sora 2 Pro / Seedance / Wan) with MCP progress notifications. |
| `generate_video_from_image` | Image-to-video. Narrower schema than `generate_video` for higher tool-call accuracy. |
| `get_video_status` | Resume polling a video generation job by ID. |
| `rerank_documents` | Rerank documents against a query (Cohere, Fireworks). |
| `search_models` | Search/filter models by name, provider, or modality. Paginated. |
| `get_model_info` | Get pricing, context length, and capabilities for any model. |
| `validate_model` | Check if a model ID exists on OpenRouter. |
| `health_check` | Verify API key, OpenRouter reachability, server + protocol versions. |

> All errors carry `_meta.code` from a closed taxonomy: `INVALID_INPUT` · `UNSAFE_PATH` · `UPSTREAM_HTTP` · `UPSTREAM_TIMEOUT` · `UPSTREAM_REFUSED` · `UNSUPPORTED_FORMAT` · `RESOURCE_TOO_LARGE` · `ZDR_INCOMPATIBLE` · `MODEL_NOT_FOUND` · `JOB_FAILED` · `JOB_STILL_RUNNING` · `INTERNAL`

## Usage Examples

**Chat with provider routing:**
```json
{
  "tool": "chat_completion",
  "arguments": {
    "model": "anthropic/claude-sonnet-4",
    "messages": [{ "role": "user", "content": "Summarize this document" }],
    "provider": { "sort": "price", "ignore": ["openai"], "data_collection": "deny" }
  }
}
```

**Generate video from Claude Desktop:**
```json
{
  "tool": "generate_video",
  "arguments": {
    "model": "google/veo-3.1",
    "prompt": "a calm river at sunrise, cinematic drone shot",
    "duration": 4,
    "save_path": "./river.mp4"
  }
}
```

**Analyze an image:**
```json
{
  "tool": "analyze_image",
  "arguments": {
    "image": "/path/to/photo.jpg",
    "prompt": "Describe what you see in detail"
  }
}
```

**Chat with caching + reasoning (v4.5):**
```json
{
  "tool": "chat_completion",
  "arguments": {
    "model": "deepseek/deepseek-r1",
    "messages": [{ "role": "user", "content": "Prove sqrt(2) is irrational" }],
    "cache": true,
    "include_reasoning": true
  }
}
```

**Web search:**
```json
{
  "tool": "chat_completion",
  "arguments": {
    "model": "openai/gpt-4o",
    "messages": [{ "role": "user", "content": "What shipped in OpenRouter last week?" }],
    "online": true
  }
}
```

**Rerank documents:**
```json
{
  "tool": "rerank_documents",
  "arguments": {
    "query": "best practices for MCP server auth",
    "documents": ["doc A text...", "doc B text...", "doc C text..."],
    "top_n": 3
  }
}
```

## Configuration

<details>
<summary><strong>Environment variables</strong> (click to expand)</summary>

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `OPENROUTER_API_KEY` | Yes | — | Your OpenRouter API key |
| `OPENROUTER_DEFAULT_MODEL` | No | `nvidia/nemotron-nano-12b-v2-vl:free` | Default model for chat + analyze tools |
| `DEFAULT_MODEL` | No | — | Alias for above |
| `OPENROUTER_MAX_TOKENS` | No | — | Default `max_tokens` when not set per-request |
| `OPENROUTER_PROVIDER_QUANTIZATIONS` | No | — | CSV. Filter by quantization (e.g. `fp16,int8`) |
| `OPENROUTER_PROVIDER_IGNORE` | No | — | CSV. Exclude provider slugs |
| `OPENROUTER_PROVIDER_SORT` | No | — | `price` / `throughput` / `latency` |
| `OPENROUTER_PROVIDER_ORDER` | No | — | JSON array or CSV of provider IDs |
| `OPENROUTER_PROVIDER_REQUIRE_PARAMETERS` | No | — | `true` / `false` |
| `OPENROUTER_PROVIDER_DATA_COLLECTION` | No | — | `allow` / `deny` |
| `OPENROUTER_PROVIDER_ALLOW_FALLBACKS` | No | — | `true` / `false` |
| `OPENROUTER_CACHE_RESPONSES` | No | — | `1` / `true`. Enable response caching server-wide |
| `OPENROUTER_INCLUDE_REASONING` | No | — | `1` / `true`. Enable reasoning passthrough server-wide |
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

### Security

- **SSRF protection** — URL fetches block private/link-local/reserved IPv4 and IPv6 targets (loopback, mapped, compat, multicast, 6to4, Teredo, ORCHID).
- **Path sandbox** — `save_path` is resolved against `OPENROUTER_OUTPUT_DIR`; traversal attempts are rejected. Override: `OPENROUTER_ALLOW_UNSAFE_PATHS=1`.
- **No credential leakage** — API key is never echoed in logs, responses, or errors. Audit logging captures every paid-op invocation.

<details>
<summary><strong>Architecture</strong></summary>

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
</details>

<details>
<summary><strong>Design Principles & Research</strong></summary>

v4.5's design draws from MCP best practices and academic research:

- **Outcomes, not operations** — Tools encapsulate whole workflows (fetch → validate → invoke → save) rather than exposing raw API primitives. Follows [Phil Schmid's MCP production guide](https://www.philschmid.de/mcp-best-practices).
- **Flattened arguments** — Top-level primitives with enums reduce tool-call failure rates. Backed by [Fu et al. (2025)](https://arxiv.org/abs/2511.03497) showing success drops with schema complexity.
- **Failure-mode documentation** — Every tool description includes "Fails when:" and "Works with:" sections, improving selection accuracy per [Schlapbach (2026)](https://arxiv.org/abs/2602.18764).
- **Untrusted content tagging** — Analyze tools mark output `_meta.content_is_untrusted: true` to mitigate indirect prompt injection ([Zhao et al., ClawGuard](https://arxiv.org/abs/2604.11790)).
- **Structured errors with retry hints** — Closed `_meta.code` taxonomy + `retry_after_seconds` beats raw error strings. Per [Apigene's 12 Rules](https://apigene.ai/blog/mcp-best-practices).
- **MCP 2025-06-18 compliance** — Structured outputs (`outputSchema`), progress notifications, tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).

**OpenRouter platform features surfaced:** [Response caching](https://openrouter.ai/announcements/response-caching) · [Web search](https://openrouter.ai/announcements/introducing-web-search-via-the-api) · [Reasoning tokens](https://openrouter.ai/announcements/reasoning-tokens-for-thinking-models) · [Auto Exacto](https://openrouter.ai/announcements/auto-exacto) · [Rerank](https://openrouter.ai/announcements/april-release-spotlight) · [Prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)

</details>

## Upgrading from v2

v3+ is **additive** — no tool schemas or env vars were removed.

- New tools: `analyze_video`, `generate_video`, `generate_video_from_image`, `get_video_status`, `rerank_documents`, `health_check`
- Structured `_meta.code` on every error response
- `save_path` sandboxed by default — set `OPENROUTER_OUTPUT_DIR` or `OPENROUTER_ALLOW_UNSAFE_PATHS=1`

## Development

```bash
git clone https://github.com/stabgan/openrouter-mcp-multimodal.git
cd openrouter-mcp-multimodal
npm install && cp .env.example .env  # Add your API key
npm run build && npm start
```

```bash
npm test                    # 288 unit tests, <1s
npm run test:integration    # Live API tests (16 scenarios)
npm run lint
node scripts/live-e2e.mjs  # 16 live E2E scenarios
```

## Compatibility

Works with any MCP client: [Kiro](https://kiro.dev) · [Claude Desktop](https://claude.ai/download) · [Cursor](https://cursor.sh) · [Windsurf](https://codeium.com/windsurf) · [Cline](https://github.com/cline/cline) · any MCP-compatible client.

## License

Apache 2.0 — see [LICENSE](./LICENSE).

## Contributing

Issues and PRs welcome. Please open an issue first for major changes.
