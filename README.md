[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/stabgan-openrouter-mcp-multimodal-badge.png)](https://mseep.ai/app/stabgan-openrouter-mcp-multimodal)

# OpenRouter MCP Multimodal Server

[![npm version](https://img.shields.io/npm/v/@stabgan/openrouter-mcp-multimodal.svg)](https://www.npmjs.com/package/@stabgan/openrouter-mcp-multimodal)
[![Docker Pulls](https://img.shields.io/docker/pulls/stabgan/openrouter-mcp-multimodal.svg)](https://hub.docker.com/r/stabgan/openrouter-mcp-multimodal)
[![Build Status](https://github.com/stabgan/openrouter-mcp-multimodal/actions/workflows/publish.yml/badge.svg)](https://github.com/stabgan/openrouter-mcp-multimodal/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An OpenRouter MCP server with native vision, image generation, and smart image optimization in one package.

Access 300+ LLMs through [OpenRouter](https://openrouter.ai) via the [Model Context Protocol](https://modelcontextprotocol.io), with first-class support for multimodal workflows: analyze images, generate images, and chat — using free or paid models.

## Why This One?

| Feature                      | This Server                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| Text chat with 300+ models   | ✅                                                                |
| Image analysis (vision)      | ✅ Native with sharp optimization                                 |
| Image generation             | ✅                                                                |
| Auto image resize & compress | ✅ (configurable; defaults 800px max, JPEG 80%)                   |
| Model search & validation    | ✅                                                                |
| Free model support           | ✅ (default: free Nemotron VL)                                    |
| Docker support               | ✅ (~345MB Alpine image)                                          |
| HTTP client                  | ✅ Node.js native `fetch` (no axios / node-fetch in this package) |

## Tools

| Tool              | Description                                                                     |
| ----------------- | ------------------------------------------------------------------------------- |
| `chat_completion` | Send messages to any OpenRouter model. Supports text and multimodal content.    |
| `analyze_image`   | Analyze images from local files, URLs, or data URIs. Auto-optimized with sharp. |
| `generate_image`  | Generate images from text prompts. Optionally save to disk.                     |
| `search_models`   | Search/filter models by name, provider, or capabilities (e.g. vision-only).     |
| `get_model_info`  | Get pricing, context length, and capabilities for any model.                    |
| `validate_model`  | Check if a model ID exists on OpenRouter.                                       |

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

### Option 3: Global install

```bash
npm install -g @stabgan/openrouter-mcp-multimodal
```

Then add to your MCP config:

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "openrouter-multimodal",
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      }
    }
  }
}
```

### Option 4: Smithery

```bash
npx -y @smithery/cli install @stabgan/openrouter-mcp-multimodal --client claude
```

## Configuration

| Environment Variable                  | Required | Default                               | Description                                           |
| ------------------------------------- | -------- | ------------------------------------- | ----------------------------------------------------- |
| `OPENROUTER_API_KEY`                  | Yes      | —                                     | Your OpenRouter API key                               |
| `OPENROUTER_DEFAULT_MODEL`            | No       | `nvidia/nemotron-nano-12b-v2-vl:free` | Default model for chat, analyze, and similar tools    |
| `DEFAULT_MODEL`                       | No       | —                                     | Alias for `OPENROUTER_DEFAULT_MODEL`                  |
| `OPENROUTER_MODEL_CACHE_TTL_MS`       | No       | `3600000`                             | How long cached `/models` data is valid (ms)          |
| `OPENROUTER_IMAGE_MAX_DIMENSION`      | No       | `800`                                 | Longest edge for resize before vision requests (px)   |
| `OPENROUTER_IMAGE_JPEG_QUALITY`       | No       | `80`                                  | JPEG quality after optimization (1–100)               |
| `OPENROUTER_IMAGE_FETCH_TIMEOUT_MS`   | No       | `30000`                               | Per-request timeout for image URLs                    |
| `OPENROUTER_IMAGE_MAX_DOWNLOAD_BYTES` | No       | `26214400`                            | Max bytes when downloading an image URL (~25 MB)      |
| `OPENROUTER_IMAGE_MAX_REDIRECTS`      | No       | `8`                                   | Max HTTP redirects when fetching an image URL         |
| `OPENROUTER_IMAGE_MAX_DATA_URL_BYTES` | No       | `20971520`                            | Approx max decoded size for base64 data URLs (~20 MB) |

### Security notes

- **`analyze_image`** can read **local files** the Node process can read and can **fetch HTTP(S) URLs**. URL fetches block private/link-local/reserved IPv4 and IPv6 targets (SSRF mitigation) and cap response size; they are still **server-side** requests—avoid pointing at internal-only hosts you rely on staying private.
- **`generate_image`** `save_path` writes to disk wherever the process has permission; treat prompts and paths like shell input from the MCP client user.

## Usage Examples

### Chat

```
Use chat_completion to explain quantum computing in simple terms.
```

### Analyze an Image

```
Use analyze_image on /path/to/photo.jpg and tell me what you see.
```

### Find Vision Models

```
Use search_models with capabilities.vision = true to find models that can see images.
```

### Generate an Image

```
Use generate_image with prompt "a cat astronaut on mars, digital art" and save to ./cat.png
```

## Architecture

```
src/
├── index.ts              # Server entry point, env validation, graceful shutdown
├── tool-handlers.ts      # Tool registration and routing
├── model-cache.ts        # In-memory model cache (1hr TTL)
├── openrouter-api.ts     # OpenRouter REST client (native fetch)
└── tool-handlers/
    ├── chat-completion.ts   # Text & multimodal chat
    ├── analyze-image.ts     # Vision analysis pipeline
    ├── generate-image.ts    # Image generation
    ├── image-utils.ts       # Sharp optimization, format detection, fetch
    ├── search-models.ts     # Model search with filtering
    ├── get-model-info.ts    # Model detail lookup
    └── validate-model.ts    # Model existence check
```

Key design decisions:

- **Native `fetch`** for OpenRouter and image URLs (no axios / node-fetch dependency in this package)
- **Lazy sharp loading** — `sharp` is loaded on first image operation, not at startup
- **Singleton model cache** — shared across tool handlers with configurable TTL (default 1 hour)
- **Bounded URL fetches** — timeouts, size limits, redirect cap, and blocked private networks for image URLs
- **Graceful error handling** — tools return structured errors instead of crashing the server
- **Process safety** — uncaught exceptions and unhandled rejections exit the process (no zombie servers)

## Development

```bash
git clone https://github.com/stabgan/openrouter-mcp-multimodal.git
cd openrouter-mcp-multimodal
npm install
cp .env.example .env  # Add your API key
npm run build
npm start
```

### Run Tests

```bash
npm test
```

`npm test` runs **unit tests** only (fast, no API key). With `OPENROUTER_API_KEY` in `.env`, run **`npm run test:integration`** for live OpenRouter tests (slower; may time out on congested networks).

**npm releases:** This repo’s `publish-npm` job uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (GitHub Actions OIDC). The package on npmjs.com must list this repository and workflow `publish.yml` under **Settings → Trusted publisher**. No long-lived `NPMJS_TOKEN` is required for publish once that is configured.

```bash
npm run lint
npm run format:check
```

### Docker Build

```bash
docker build -t openrouter-mcp .
docker run -i -e OPENROUTER_API_KEY=sk-or-v1-... openrouter-mcp
```

Multi-stage build: 345MB final image (Alpine + vips runtime only).

## Compatibility

Works with any MCP client:

- [Claude Desktop](https://claude.ai/download)
- [Cursor](https://cursor.sh)
- [Kiro](https://kiro.dev)
- [Windsurf](https://codeium.com/windsurf)
- [Cline](https://github.com/cline/cline)
- Any MCP-compatible client

## License

MIT

## Contributing

Issues and PRs welcome. Please open an issue first for major changes.
