<p align="center">
  <img src="assets/logo.png" alt="OpenRouter MCP Multimodal — MCP server for chat, vision, audio, and video AI tools" width="128" height="128" />
</p>

<h1 align="center">OpenRouter MCP Multimodal</h1>

<p align="center">
  <strong>The MCP server for multimodal AI agents.</strong><br/>
  One install · 19 tools · 300+ OpenRouter models · text, vision, audio &amp; video — analysis and generation.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@stabgan/openrouter-mcp-multimodal"><img src="https://img.shields.io/npm/v/@stabgan/openrouter-mcp-multimodal.svg?label=npm&color=cb3837&logo=npm" alt="npm version" /></a>
  <a href="https://pypi.org/project/mcp-server-openrouter-multimodal/"><img src="https://img.shields.io/pypi/v/mcp-server-openrouter-multimodal.svg?label=pypi&color=3775A9&logo=pypi&logoColor=white" alt="PyPI version" /></a>
  <a href="https://github.com/stabgan/openrouter-mcp-multimodal/releases"><img src="https://img.shields.io/github/v/release/stabgan/openrouter-mcp-multimodal?label=release&color=6366f1" alt="GitHub release" /></a>
  <a href="https://hub.docker.com/r/stabgan/openrouter-mcp-multimodal"><img src="https://img.shields.io/docker/v/stabgan/openrouter-mcp-multimodal/latest?label=docker&color=2496ed&logo=docker&logoColor=white" alt="Docker version" /></a>
  <a href="https://github.com/stabgan/openrouter-mcp-multimodal/actions/workflows/ci.yml"><img src="https://github.com/stabgan/openrouter-mcp-multimodal/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://www.apache.org/licenses/LICENSE-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="Apache 2.0 license" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A520-43853d?logo=node.js&logoColor=white" alt="Node.js 20+" /></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@stabgan/openrouter-mcp-multimodal"><img src="https://img.shields.io/npm/dt/@stabgan/openrouter-mcp-multimodal.svg?label=npm%20downloads&color=cb3837&logo=npm" alt="npm downloads" /></a>
  <a href="https://hub.docker.com/r/stabgan/openrouter-mcp-multimodal"><img src="https://img.shields.io/docker/pulls/stabgan/openrouter-mcp-multimodal.svg?label=docker%20pulls&color=2496ed&logo=docker&logoColor=white" alt="Docker pulls" /></a>
  <a href="https://registry.modelcontextprotocol.io/servers/io.github.stabgan/openrouter-multimodal"><img src="https://img.shields.io/badge/MCP_Registry-listed-6366f1" alt="MCP Registry" /></a>
  <a href="https://smithery.ai/server/@stabgan/openrouter-mcp-multimodal"><img src="https://img.shields.io/badge/Smithery-Install-6366f1" alt="Smithery MCP registry" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#tools">Tools</a> ·
  <a href="#examples">Examples</a> ·
  <a href="#security">Security</a> ·
  <a href="#troubleshooting">Troubleshooting</a> ·
  <a href="#development">Development</a> ·
  <a href="#releasing">Releasing</a> ·
  <a href="#faq">FAQ</a>
</p>

---

## What is this?

**OpenRouter MCP Multimodal** is a production-grade [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server — listed on the [official MCP Registry](https://registry.modelcontextprotocol.io/servers/io.github.stabgan/openrouter-multimodal) as `io.github.stabgan/openrouter-multimodal`. It connects AI coding agents ([Cursor](https://cursor.com), [Claude Desktop](https://claude.ai/download), [VS Code](https://code.visualstudio.com), [Windsurf](https://codeium.com/windsurf), [Cline](https://github.com/cline/cline), and others) to [OpenRouter](https://openrouter.ai)'s unified LLM API over stdio.

Unlike text-only MCP servers, one install covers the **full multimodal surface**:

| Capability  | Tools                                                                                   | Highlights                                                                                                                                                                        |
| :---------- | :-------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chat**    | `chat_completion`, `start_chat_completion`, `get_chat_completion_status`                | 300+ models, `:nitro` / `:floor` / `:free` / `:online` / `:exacto` suffixes, provider routing, web search, response caching, reasoning tokens, async jobs for long-running models |
| **Vision**  | `analyze_image`, `generate_image`, `generate_image_dedicated`                           | OCR, captioning, VQA, image generation with reference inputs, dedicated Image API with resolution/quality/format control                                                          |
| **Audio**   | `analyze_audio`, `generate_audio`, `text_to_speech`, `speech_to_text`                   | Transcription, speech/music generation, dedicated TTS (OpenAI/Gemini/Voxtral voices), dedicated STT (Whisper/GPT-4o Transcribe)                                                   |
| **Video**   | `analyze_video`, `generate_video`, `generate_video_from_image`, `get_video_status`      | Clip understanding, Veo 3.1 / Seedance 2.0 / Wan 2.7 generation with progress notifications                                                                                       |
| **Catalog** | `search_models`, `get_model_info`, `validate_model`, `rerank_documents`, `health_check` | Model discovery, validation, reranking, ops health                                                                                                                                |

**Production hardening:** input/output path sandboxes (including analyze\_\* local files as of v4.5.2), SSRF guards, structured errors with `_meta.code`, MCP 2025-06-18 structured outputs, tool icons (2025-11-25), async video progress notifications, and **1000+** automated tests (unit, mock, regression, and live integration).

## Quick start

**1. Get an API key** (free tier works) → [openrouter.ai/keys](https://openrouter.ai/keys)

**2. Run the server**

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
npx -y @stabgan/openrouter-mcp-multimodal
```

**3. Add to your MCP client** — copy one JSON block from [Install](#install) into your client config:

| Client             | Config location                                                                                                                   |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| **Cursor**         | Project: `.cursor/mcp.json` · User: Cursor Settings → MCP                                                                         |
| **Claude Desktop** | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` · Windows: `%APPDATA%\Claude\claude_desktop_config.json` |
| **VS Code**        | `.vscode/mcp.json` (workspace) or User Settings → MCP                                                                             |
| **Windsurf**       | Windsurf Settings → MCP (same `mcpServers` JSON shape as Cursor)                                                                  |

Use the `mcpServers` object from [Manual config](#manual-config) below.

> **No credits required to start.** Free models such as `google/gemma-4-26b-a4b-it:free` work for chat and vision. Video/audio generation typically needs credits.

## Install

MCP servers are distributed through several packaging models. **This server is implemented in Node.js/TypeScript**; the table below maps each ecosystem method to how you run it here.

| Method                                  | Runtime                          | Best for                                                       | This server                                                                                            |
| :-------------------------------------- | :------------------------------- | :------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| **[npx](#manual-config)**               | Node.js 20+                      | Most MCP clients (default)                                     | ✅ `@stabgan/openrouter-mcp-multimodal`                                                                |
| **[uvx / pipx](#manual-config)**        | Python 3.10+ **and** Node.js 20+ | Python-first workflows, same pattern as PyPI MCP servers       | ✅ [`mcp-server-openrouter-multimodal`](https://pypi.org/project/mcp-server-openrouter-multimodal/)    |
| **[npm global](#manual-config)**        | Node.js 20+                      | Pin a version without re-downloading                           | ✅                                                                                                     |
| **[node (local)](#manual-config)**      | Node.js 20+                      | Contributors / air-gapped builds                               | ✅                                                                                                     |
| **[Docker Hub](#manual-config)**        | Docker                           | Isolation, no Node on host                                     | ✅ `stabgan/openrouter-mcp-multimodal`                                                                 |
| **[GHCR](#manual-config)**              | Docker                           | GitHub-native OCI pulls                                        | ✅ `ghcr.io/stabgan/openrouter-mcp-multimodal`                                                         |
| **[Smithery CLI](#smithery)**           | Node.js (via installer)          | Interactive install into Claude/Cursor/etc.                    | ✅                                                                                                     |
| **[MCP Registry](#mcp-registry)**       | npm or OCI                       | Official discovery (`io.github.stabgan/openrouter-multimodal`) | ✅ [listing](https://registry.modelcontextprotocol.io/servers/io.github.stabgan/openrouter-multimodal) |
| **[One-click deeplinks](#one-click)**   | Node.js                          | Cursor, VS Code, Kiro                                          | ✅                                                                                                     |
| **[Claude Code CLI](#claude-code-cli)** | Node.js                          | Terminal-first Claude Code users                               | ✅                                                                                                     |
| **[MCP Inspector](#mcp-inspector)**     | Node.js                          | Debug / list tools locally                                     | ✅                                                                                                     |
| **Windows `cmd /c npx`**                | Node.js                          | Claude Desktop / Cursor when `npx` not on GUI PATH             | ✅ [see below](#windows-npx)                                                                           |
| pip / uv (direct)                       | —                                | Native Python MCP servers only                                 | — use **uvx** row above                                                                                |
| DXT desktop extensions                  | —                                | Bundled Claude Desktop `.dxt`                                  | not yet                                                                                                |
| Remote HTTP / SSE                       | —                                | Hosted Smithery / Cloudflare endpoints                         | via [Smithery](https://smithery.ai/server/@stabgan/openrouter-mcp-multimodal)                          |

> **uvx vs npx:** In the MCP ecosystem, **`npx` runs npm (Node) packages** and **`uvx` runs PyPI (Python) packages**. Because this server is Node-based, `uvx` uses a thin [Python launcher](./python/) that execs `npx -y @stabgan/openrouter-mcp-multimodal` — you still need Node installed.

### One-click

<table>
<tr><td><strong>Cursor</strong></td><td><a href="https://cursor.com/en/install-mcp?name=openrouter&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBzdGFiZ2FuL29wZW5yb3V0ZXItbWNwLW11bHRpbW9kYWwiXSwiZW52Ijp7Ik9QRU5ST1VURVJfQVBJX0tFWSI6InNrLW9yLXYxLS4uLiJ9fQ%3D%3D"><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add OpenRouter MCP to Cursor" /></a></td></tr>
<tr><td><strong>VS Code</strong></td><td><a href="https://insiders.vscode.dev/redirect/mcp/install?name=openrouter&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40stabgan%2Fopenrouter-mcp-multimodal%22%5D%2C%22env%22%3A%7B%22OPENROUTER_API_KEY%22%3A%22sk-or-v1-...%22%7D%7D"><img src="https://img.shields.io/badge/Add_to-VS_Code-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Add to VS Code" /></a></td></tr>
<tr><td><strong>Kiro</strong></td><td><a href="https://kiro.dev/launch/mcp/add?name=openrouter&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40stabgan%2Fopenrouter-mcp-multimodal%22%5D%2C%22env%22%3A%7B%22OPENROUTER_API_KEY%22%3A%22sk-or-v1-...%22%7D%2C%22disabled%22%3Afalse%2C%22autoApprove%22%3A%5B%5D%7D"><img src="https://img.shields.io/badge/Add_to-Kiro-232F3E?style=for-the-badge&logo=amazonaws&logoColor=white" alt="Add to Kiro" /></a></td></tr>
<tr><td><strong>Claude Desktop / Windsurf / Cline</strong></td><td><a href="#manual-config">Manual JSON config</a> (pick any method below)</td></tr>
<tr><td><strong>Smithery</strong></td><td><a href="https://smithery.ai/server/@stabgan/openrouter-mcp-multimodal"><code>npx -y @smithery/cli install @stabgan/openrouter-mcp-multimodal --client claude</code></a></td></tr>
<tr><td><strong>MCP Registry</strong></td><td><a href="https://registry.modelcontextprotocol.io/servers/io.github.stabgan/openrouter-multimodal">Official registry page</a> — npm + OCI packages</td></tr>
</table>

Paste your `OPENROUTER_API_KEY` when prompted — deeplinks use placeholders so secrets never appear in URLs.

### Manual config

<details open>
<summary><strong>npx (recommended)</strong></summary>

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
npx -y @stabgan/openrouter-mcp-multimodal
```

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

Pin a release: `"args": ["-y", "@stabgan/openrouter-mcp-multimodal@4.8.0"]`

</details>

<details>
<summary><strong>uvx / pipx (Python launcher)</strong></summary>

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) (includes `uvx`), ensure **Node.js 20+** is also on your `PATH`, then:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
uvx mcp-server-openrouter-multimodal
# pin npm version: OPENROUTER_MCP_NPM_VERSION=4.8.0 uvx mcp-server-openrouter-multimodal
```

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "uvx",
      "args": ["mcp-server-openrouter-multimodal"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      }
    }
  }
}
```

**pipx equivalent:** `pipx run mcp-server-openrouter-multimodal`

Optional: `OPENROUTER_MCP_NPM_VERSION=4.8.0` pins the underlying npm package.

</details>

<details>
<summary><strong>npm global</strong></summary>

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

<details>
<summary><strong>node (local clone)</strong></summary>

```bash
git clone https://github.com/stabgan/openrouter-mcp-multimodal.git
cd openrouter-mcp-multimodal
npm ci && npm run build
```

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "node",
      "args": ["/absolute/path/to/openrouter-mcp-multimodal/dist/index.js"],
      "env": { "OPENROUTER_API_KEY": "sk-or-v1-..." }
    }
  }
}
```

</details>

<details>
<summary><strong>Docker</strong></summary>

```bash
docker run --rm -i -e OPENROUTER_API_KEY=sk-or-v1-... stabgan/openrouter-mcp-multimodal:latest
```

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e",
        "OPENROUTER_API_KEY=sk-or-v1-...",
        "stabgan/openrouter-mcp-multimodal:latest"
      ]
    }
  }
}
```

Use `-i` (interactive stdio). Avoid `-t` (TTY corrupts MCP framing on some hosts).

</details>

<details>
<summary><strong>GHCR (GitHub Container Registry)</strong></summary>

```bash
docker run --rm -i -e OPENROUTER_API_KEY=sk-or-v1-... \
  ghcr.io/stabgan/openrouter-mcp-multimodal:4.8.0
```

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e",
        "OPENROUTER_API_KEY=sk-or-v1-...",
        "ghcr.io/stabgan/openrouter-mcp-multimodal:4.8.0"
      ]
    }
  }
}
```

</details>

<details>
<summary><strong>Smithery</strong></summary>

Interactive install (writes config for your client):

```bash
npx -y @smithery/cli install @stabgan/openrouter-mcp-multimodal --client claude
# or: --client cursor | vscode | windsurf | ...
```

Listing: [smithery.ai/server/@stabgan/openrouter-mcp-multimodal](https://smithery.ai/server/@stabgan/openrouter-mcp-multimodal)

</details>

<details>
<summary><strong>MCP Registry</strong></summary>

Official name: `io.github.stabgan/openrouter-multimodal`

- Registry: [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/servers/io.github.stabgan/openrouter-multimodal)
- npm package: `@stabgan/openrouter-mcp-multimodal`
- OCI image: `docker.io/stabgan/openrouter-mcp-multimodal`

Clients that support registry-driven install will offer npm or Docker; otherwise use the JSON blocks above.

</details>

<details>
<summary><strong>Claude Code CLI</strong></summary>

```bash
claude mcp add openrouter -- npx -y @stabgan/openrouter-mcp-multimodal
# project scope:
claude mcp add --scope project openrouter -- npx -y @stabgan/openrouter-mcp-multimodal
```

Set `OPENROUTER_API_KEY` in your shell or client env before starting Claude Code.

</details>

<details>
<summary><strong>MCP Inspector</strong></summary>

Debug tools/list and tool calls against a live OpenRouter key:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
npx -y @modelcontextprotocol/inspector npx -y @stabgan/openrouter-mcp-multimodal
```

</details>

<details>
<summary><strong>Windows npx</strong></summary>

When Claude Desktop or Cursor cannot find `npx` (GUI apps often miss shell `PATH`), wrap with `cmd`:

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@stabgan/openrouter-mcp-multimodal"],
      "env": { "OPENROUTER_API_KEY": "sk-or-v1-..." }
    }
  }
}
```

If still failing, use the full path from `where npx` as the command.

</details>

## Why this server?

| Capability                           | This server | Typical MCP LLM servers |
| :----------------------------------- | :---------: | :---------------------: |
| Text chat (300+ models)              |     ✅      |           ✅            |
| Image analysis + generation          |     ✅      |         partial         |
| Audio analysis + TTS                 |     ✅      |           ❌            |
| Video analysis + generation          |     ✅      |           ❌            |
| Model search / validate / rerank     |     ✅      |           ❌            |
| Path sandbox + SSRF protection       |     ✅      |          rare           |
| MCP 2025 structured outputs          |     ✅      |          rare           |
| Async video + progress notifications |     ✅      |           ❌            |

## Tools

19 MCP tools. Each description includes **Use when**, **Good/Bad examples**, **Fails when**, and **Works with** so agents pick the right tool and recover from errors.

| Tool                         | Purpose                                                                    |
| :--------------------------- | :------------------------------------------------------------------------- |
| `chat_completion`            | Text chat, web search, provider routing, caching, reasoning                |
| `start_chat_completion`      | Async background job for long-running reasoning models                     |
| `get_chat_completion_status` | Poll / retrieve async completion results                                   |
| `analyze_image`              | Vision — local path, URL, or data URL + `question`                         |
| `analyze_audio`              | Transcribe / analyze audio files                                           |
| `analyze_video`              | Describe / Q&A over video files                                            |
| `generate_image`             | Text-to-image via chat completions with reference images                   |
| `generate_image_dedicated`   | Text-to-image via dedicated `/api/v1/images` (resolution, quality, format) |
| `generate_audio`             | Text-to-speech / music via chat completions                                |
| `text_to_speech`             | Dedicated TTS (`/api/v1/audio/speech`) — voices, speed, format             |
| `speech_to_text`             | Dedicated STT (`/api/v1/audio/transcriptions`) — Whisper, GPT-4o           |
| `generate_video`             | Text-to-video (async, resumable)                                           |
| `generate_video_from_image`  | Image-to-video (narrower schema)                                           |
| `get_video_status`           | Poll / resume video jobs                                                   |
| `search_models`              | Paginated model catalog search                                             |
| `get_model_info`             | Pricing, context, modalities                                               |
| `validate_model`             | Cheap model ID existence check                                             |
| `rerank_documents`           | Relevance ranking for RAG                                                  |
| `health_check`               | API key + reachability probe                                               |

Errors use a closed `_meta.code` taxonomy: `INVALID_INPUT` · `UNSAFE_PATH` · `UPSTREAM_*` · `MODEL_NOT_FOUND` · `JOB_STILL_RUNNING` · and more.

### Binary tool results (v4.7.0+)

Generate tools (`generate_image`, `generate_image_dedicated`, `generate_audio`, `text_to_speech`, `generate_video`, `generate_video_from_image`, `get_video_status`) return image, audio, or video bytes. As of **4.7.0** the behavior is explicit:

| `save_path`                   | Tool result                                                                                                                                                                      |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Set**                       | **Text pointer only** — e.g. `Image saved to: out.png (… bytes, image/png)` plus `_meta.save_path`. **No inline base64** (avoids duplicating large payloads in the MCP channel). |
| **Unset, under byte ceiling** | Inline media block **and** summary text (images/audio use MCP `image` / `audio` types; video uses MCP `resource` blocks).                                                        |
| **Unset, over ceiling**       | Text only with a hint to pass `save_path`.                                                                                                                                       |

Default inline ceilings (override per kind or globally):

| Kind  | Default | Env vars (precedence: per-kind → global)                            |
| :---- | :------ | :------------------------------------------------------------------ |
| Image | 1 MiB   | `OPENROUTER_IMAGE_INLINE_MAX_BYTES` → `OPENROUTER_INLINE_MAX_BYTES` |
| Audio | 1 MiB   | `OPENROUTER_AUDIO_INLINE_MAX_BYTES` → `OPENROUTER_INLINE_MAX_BYTES` |
| Video | 10 MiB  | `OPENROUTER_VIDEO_INLINE_MAX_BYTES` → `OPENROUTER_INLINE_MAX_BYTES` |

If you previously relied on **both** a saved file **and** inline media in the same tool result, read the file from `_meta.save_path` (or omit `save_path` to get inline media when under the ceiling).

## Examples

### Chat (free model)

```json
{
  "tool": "chat_completion",
  "arguments": {
    "model": "google/gemma-4-26b-a4b-it:free",
    "messages": [{ "role": "user", "content": "Summarize MCP in one sentence." }]
  }
}
```

### Analyze an image

```json
{
  "tool": "analyze_image",
  "arguments": {
    "image_path": "diagram.png",
    "question": "List every label in this diagram."
  }
}
```

> Use `image_path` and `question` — not `image` / `prompt`.

### Search models (vision + free)

```json
{
  "tool": "search_models",
  "arguments": {
    "query": "gemma",
    "capabilities": { "vision": true },
    "limit": 10,
    "offset": 0
  }
}
```

### Generate video (async)

```json
{
  "tool": "generate_video",
  "arguments": {
    "model": "google/veo-3.1",
    "prompt": "Ocean waves at sunrise, cinematic drone shot",
    "duration": 4,
    "save_path": "river.mp4"
  }
}
```

If the job is still running when `max_wait_ms` elapses, the response succeeds with `_meta.code: JOB_STILL_RUNNING` and a `video_id` — call `get_video_status` to resume. **This is not an error.**

With `save_path` set (as above), the result is a **text pointer** to the saved file once complete — not inline video. See [Binary tool results](#binary-tool-results-v470).

More examples: [docs/plans/tool-description-improvement.md](./docs/plans/tool-description-improvement.md)

## Security

- **Input path sandbox** — local paths on `analyze_*` and reference images must stay inside `OPENROUTER_INPUT_DIR` (falls back to `OPENROUTER_OUTPUT_DIR`, then `cwd`)
- **Output path sandbox** — `save_path` must stay inside `OPENROUTER_OUTPUT_DIR`
- **Async job reads** — `get_chat_completion_status` resolves disk paths only under `OPENROUTER_OUTPUT_DIR/openrouter-jobs/` (4.7.0+)
- **SSRF protection** — private/reserved IPs blocked on URL fetches
- **Untrusted content** — analyze outputs tagged `_meta.content_is_untrusted: true`

Override sandboxes only with `OPENROUTER_ALLOW_UNSAFE_PATHS=1` (discouraged).

Report vulnerabilities: **[SECURITY.md](./SECURITY.md)** (private disclosure — do not file public issues for exploits).

## Configuration

<details>
<summary><strong>Environment variables</strong></summary>

| Variable                            | Required | Default                               | Description                         |
| :---------------------------------- | :------: | :------------------------------------ | :---------------------------------- |
| `OPENROUTER_API_KEY`                | **Yes**  | —                                     | OpenRouter API key                  |
| `OPENROUTER_DEFAULT_MODEL`          |    No    | `nvidia/nemotron-nano-12b-v2-vl:free` | Default when tools omit `model`     |
| `OPENROUTER_OUTPUT_DIR`             |    No    | `cwd`                                 | Sandbox root for `save_path`        |
| `OPENROUTER_INPUT_DIR`              |    No    | `OUTPUT_DIR` or `cwd`                 | Sandbox root for local input files  |
| `OPENROUTER_INLINE_MAX_BYTES`       |    No    | `1048576` (image/audio)               | Global inline media ceiling         |
| `OPENROUTER_IMAGE_INLINE_MAX_BYTES` |    No    | falls back to global                  | Per-kind inline ceiling             |
| `OPENROUTER_AUDIO_INLINE_MAX_BYTES` |    No    | falls back to global                  | Per-kind inline ceiling             |
| `OPENROUTER_VIDEO_INLINE_MAX_BYTES` |    No    | `10485760`                            | Video inline ceiling                |
| `OPENROUTER_LOG_LEVEL`              |    No    | `info`                                | `error` / `warn` / `info` / `debug` |

See [`.env.example`](./.env.example) for the full list (provider routing, fetch limits, caching, video polling, async jobs, integration-test overrides).

</details>

## Development

```bash
git clone https://github.com/stabgan/openrouter-mcp-multimodal.git
cd openrouter-mcp-multimodal
npm install
cp .env.example .env   # add OPENROUTER_API_KEY
npm run build
```

### Testing

| Command                    | What it runs                                               |
| :------------------------- | :--------------------------------------------------------- |
| `npm test`                 | **1018** unit + mock tests (no API key, &lt;20s)           |
| `npm run test:regression`  | Security + schema regression guards                        |
| `npm run test:integration` | **16** live OpenRouter scenarios (**requires** `.env` key) |
| `npm run test:e2e`         | Full MCP stdio smoke (`scripts/live-e2e.mjs`)              |
| `npm run ci`               | lint + format + build + **all** of the above except e2e    |

**Free models for CI / zero-credit accounts:** integration tests default to `google/gemma-4-26b-a4b-it:free` (override with `OPENROUTER_INTEGRATION_MODEL`). GitHub Actions requires the `OPENROUTER_API_KEY` repository secret.

Mock tests live under `src/__tests__/mock/` and cover handlers, path sandboxes, SSRF blocks, model-cache pagination, tool descriptions, and structured outputs — **330+** additional cases beyond the core suite.

```bash
npm run lint
npm run format:check
npm run version:check   # package.json vs src/version.ts, server.json, pyproject.toml
```

## Releasing

Published artifacts (**npm**, **PyPI/uvx**, **Docker**, **GHCR**) all ship from the **same semver** on a git tag (`vX.Y.Z`). Pushing to `main` runs tests but does **not** publish to npm or PyPI.

**Normal flow:** merge conventional commits to `main` → [Release Please](https://github.com/googleapis/release-please) opens a Release PR → merge it → tag is created → CI publishes everywhere.

**Manual flow:** bump all version files → `npm run version:check` → `npm run ci` + smoke tests → commit → `git tag vX.Y.Z` → `git push origin vX.Y.Z`.

Full checklist, file list, CI secrets, and agent instructions:

- **[`docs/RELEASING.md`](docs/RELEASING.md)** — maintainer release guide
- **[`AGENTS.md`](AGENTS.md)** — quick reference for AI agents

## Troubleshooting

| Symptom                                                     | Likely cause                             | Fix                                                                                                             |
| :---------------------------------------------------------- | :--------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| Server exits immediately / `OPENROUTER_API_KEY is required` | Missing or empty API key                 | Set `OPENROUTER_API_KEY` in client `env` or shell — get one at [openrouter.ai/keys](https://openrouter.ai/keys) |
| `_meta.code: INVALID_CREDENTIALS` or HTTP 401               | Bad or revoked key                       | Regenerate at [openrouter.ai/keys](https://openrouter.ai/keys); restart the MCP client                          |
| `_meta.code: MODEL_NOT_FOUND`                               | Typo or retired model ID                 | Run `search_models` or `validate_model`; check [openrouter.ai/models](https://openrouter.ai/models)             |
| HTTP 402 / insufficient credits                             | Paid model or generation on zero balance | Add credits at [openrouter.ai/credits](https://openrouter.ai/credits) or use a `:free` model                    |
| `_meta.code: UPSTREAM_HTTP` with 429                        | Rate limit                               | Wait for `_meta.retry_after_seconds` if present; reduce concurrency                                             |
| `_meta.code: UNSAFE_PATH`                                   | Local path outside sandbox               | Put files under `OPENROUTER_INPUT_DIR` or set `OPENROUTER_OUTPUT_DIR` wider; see [Security](#security)          |
| `npx` not found (Windows GUI apps)                          | GUI `PATH` differs from terminal         | Use the [Windows npx](#windows-npx) `cmd /c` wrapper                                                            |
| No inline image/audio after upgrade                         | **v4.7.0** with `save_path` set          | Expected — result is text + `_meta.save_path` only; omit `save_path` or read the saved file                     |
| MCP client shows stale tool list                            | Client cache                             | Restart MCP / reload window after upgrading the package pin                                                     |

Structured errors include `_meta.suggestions` with agent-oriented next steps when available.

## FAQ

### Do I need paid OpenRouter credits?

No, to get started. Free models work for chat and vision. Audio/video **generation** usually requires credits; analysis may return `402` on some models — the server surfaces that as a structured error.

### Which MCP clients are supported?

Any MCP-compatible client over stdio: Cursor, Claude Desktop, VS Code Copilot, Windsurf, Cline, Kiro, and custom agents.

### How is this different from calling OpenRouter directly?

This server adds MCP tool schemas, security sandboxes, error taxonomy, model caching, async video polling with progress notifications, and agent-oriented tool descriptions — so LLMs invoke the right capability without custom HTTP glue.

### Where is the security advisory for path traversal?

Fixed in 4.5.2+ — see [GHSA-3q7p-736f-x44v](https://github.com/stabgan/openrouter-mcp-multimodal/security/advisories/GHSA-3q7p-736f-x44v), [`SECURITY.md`](./SECURITY.md), and `docs/solutions/security-issues/`.

## Compatibility

Works with any MCP client. Protocol: **MCP 2025-06-18**. Node **≥ 20** (Docker image uses Node 22).

## License

Apache 2.0 — see [LICENSE](./LICENSE).

## Contributing

Issues and PRs welcome. For large changes, open an issue first.

Before submitting: run **`npm run ci`**. Use [Conventional Commits](https://www.conventionalcommits.org/) (`fix:`, `feat:`, etc.) so [Release Please](docs/RELEASING.md) can cut the next release. See **[`docs/RELEASING.md`](docs/RELEASING.md)** if you need to ship a version.
