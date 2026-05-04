#!/usr/bin/env node
/**
 * Build a rich MCPB manifest.json for .mcpb-build/ with full tool schemas
 * derived from the live server (via scripts/dump-tools.mjs).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const tools = JSON.parse(readFileSync('/tmp/tools-clean.json', 'utf8'));

const manifest = {
  manifest_version: '0.3',
  name: 'openrouter-mcp-multimodal',
  display_name: 'OpenRouter MCP Multimodal',
  version: '4.5.0',
  description: 'Chat with 300+ LLMs via OpenRouter. Analyze and generate images, audio, and video from MCP.',
  long_description:
    'All-in-one MCP server for OpenRouter. Chat with 300+ LLMs (Claude, Gemini, GPT, Llama, Qwen, Grok). ' +
    'Analyze images, audio, and video. Generate images, speech, music, and video (Veo 3.1, Sora 2 Pro, ' +
    'Seedance, Wan). generate_image supports reference images for character / style consistency, ' +
    'aspect_ratio (14 values), image_size (0.5K / 1K / 2K / 4K), and modalities override. Structured ' +
    'error taxonomy, IPv4+IPv6 SSRF guards, path sandbox, multi-arch Docker. Works with Claude Desktop, ' +
    'Cursor, Kiro, VS Code, Windsurf, Cline, and any MCP-compatible client.',
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
      default: 'nvidia/nemotron-nano-12b-v2-vl:free',
      required: false,
    },
    output_dir: {
      type: 'string',
      title: 'Output Directory',
      description: 'Sandbox root for save_path on generate_* tools. Leave empty to use the current working directory.',
      required: false,
    },
    input_dir: {
      type: 'string',
      title: 'Input Directory',
      description: 'Sandbox root for input_images on generate_image. Falls back to the Output Directory.',
      required: false,
    },
  },
  tools,
  keywords: [
    'openrouter', 'mcp', 'multimodal', 'claude', 'gemini', 'gpt',
    'vision', 'image-generation', 'video-generation', 'tts', 'stt',
    'veo', 'sora', 'ai-agent', 'claude-desktop',
  ],
  license: 'Apache-2.0',
  compatibility: {
    platforms: ['darwin', 'win32', 'linux'],
    runtimes: { node: '>=18.0.0' },
  },
};

writeFileSync('.mcpb-build/manifest.json', JSON.stringify(manifest, null, 2));
console.log(`Wrote .mcpb-build/manifest.json with ${tools.length} tools embedded`);
