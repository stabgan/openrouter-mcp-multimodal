#!/usr/bin/env node
/**
 * Build an MCPB manifest.json for .mcpb-build/ from the tool names +
 * descriptions + inputSchema dumped by scripts/dump-tools.mjs.
 *
 * Note: the Smithery Registry's publish endpoint REQUIRES each tool to
 * carry its full `inputSchema`, so we pass that through. The stricter
 * `@anthropic-ai/mcpb validate` command rejects `inputSchema` /
 * `outputSchema` / `annotations` as unknown keys — so we deliberately
 * skip `mcpb validate` in the build pipeline. `mcpb pack` itself
 * accepts the richer shape (it just warns).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const rawTools = JSON.parse(readFileSync('/tmp/tools-clean.json', 'utf8'));
// Keep name, description, and inputSchema — these are what Smithery
// displays on the listing card and feeds into the "tools available"
// badge. Drop `outputSchema` / `annotations` since MCPB's base schema
// doesn't list them; they come from the running server at tools/list
// time anyway.
const tools = rawTools.map((t) => {
  const out = {
    name: t.name,
    description: String(t.description ?? '').split('\n\n')[0].trim(),
  };
  if (t.inputSchema) out.inputSchema = t.inputSchema;
  return out;
});

const manifest = {
  manifest_version: '0.2',
  name: 'openrouter-mcp-multimodal',
  display_name: 'OpenRouter MCP Multimodal',
  version: pkg.version,
  description: 'Chat with 300+ LLMs via OpenRouter. 21 tools: analyze and generate images, audio, and video. Embeddings, reranking, structured decisions, TTS/STT from MCP.',
  long_description:
    'All-in-one MCP server for OpenRouter. 21 tools covering chat with 300+ LLMs (Claude, Gemini, GPT, Llama, Qwen, Grok), ' +
    'analyze images/audio/video, generate images (chat + dedicated API), speech (TTS/STT with Deepgram, ElevenLabs, OpenAI), ' +
    'music, and video (Veo 3.1, Kling v3.0, Seedance 2.5, Wan 2.7). Vector embeddings (37+ models), document reranking, ' +
    'structured decisions (System One models), async completions, response caching, provider routing, web search, ' +
    'multi-model fusion, structured output (JSON Schema), MCP 2025-11-25 structured outputs + tool icons + progress notifications. Apache 2.0.',
  author: { name: 'stabgan', url: 'https://github.com/stabgan' },
  repository: { type: 'git', url: 'https://github.com/stabgan/openrouter-mcp-multimodal.git' },
  homepage: 'https://github.com/stabgan/openrouter-mcp-multimodal',
  documentation: 'https://github.com/stabgan/openrouter-mcp-multimodal#readme',
  support: 'https://github.com/stabgan/openrouter-mcp-multimodal/issues',
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.js'],
      env: {
        OPENROUTER_API_KEY: '${user_config.openrouter_api_key}',
        OPENROUTER_DEFAULT_MODEL: '${user_config.default_model}',
        OPENROUTER_OUTPUT_DIR: '${user_config.output_dir}',
        OPENROUTER_INPUT_DIR: '${user_config.input_dir}',
      },
    },
  },
  user_config: {
    openrouter_api_key: {
      type: 'string',
      title: 'OpenRouter API Key',
      description: 'Your OpenRouter API key. Get one free at https://openrouter.ai/keys',
      sensitive: true,
      required: true,
    },
    default_model: {
      type: 'string',
      title: 'Default Model',
      description: 'Default model for chat + analyze tools.',
      default: 'google/gemma-4-26b-a4b-it:free',
      required: false,
    },
    output_dir: {
      type: 'directory',
      title: 'Output Directory',
      description: 'Sandbox root for save_path on generate_* tools. Leave empty to use the current working directory.',
      required: false,
    },
    input_dir: {
      type: 'directory',
      title: 'Input Directory',
      description: 'Sandbox root for input_images on generate_image. Falls back to the Output Directory.',
      required: false,
    },
  },
  tools,
  keywords: [
    'openrouter', 'mcp', 'multimodal', 'claude', 'gemini', 'gpt',
    'vision', 'image-generation', 'video-generation', 'tts', 'stt',
    'veo', 'kling', 'ai-agent', 'claude-desktop', 'embeddings',
    'reranking', 'decisions', 'deepgram', 'elevenlabs',
  ],
  license: 'Apache-2.0',
  compatibility: {
    platforms: ['darwin', 'win32', 'linux'],
    runtimes: { node: '>=22.0.0' },
  },
};

writeFileSync('.mcpb-build/manifest.json', JSON.stringify(manifest, null, 2));
console.log(`Wrote .mcpb-build/manifest.json with ${tools.length} tools embedded`);
