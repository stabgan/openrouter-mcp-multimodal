import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import OpenAI from 'openai';
import { handleGenerateAudio } from '../tool-handlers/generate-audio.js';
import { handleTextToSpeech } from '../tool-handlers/text-to-speech.js';
import { handleGenerateImageDedicated } from '../tool-handlers/generate-image-dedicated.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode } from '../errors.js';

function mockOpenAI(): OpenAI {
  return { chat: { completions: { create: vi.fn() } } } as unknown as OpenAI;
}

describe('save_path sandbox guards (resolveOptionalOutputPath)', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'mcp-save-path-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  const noopApi = {
    generateImage: vi.fn(),
    generateSpeech: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('generate_audio rejects traversal before OpenAI call', async () => {
    const openai = mockOpenAI();
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'hello', save_path: '../escape.wav' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UNSAFE_PATH);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('text_to_speech rejects traversal before API call', async () => {
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', save_path: '../../../etc/out.mp3' } } },
      noopApi,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UNSAFE_PATH);
    expect(noopApi.generateSpeech).not.toHaveBeenCalled();
  });

  it('generate_image_dedicated rejects absolute paths outside output root', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a dot', save_path: '/etc/outside.png' } } },
      noopApi,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UNSAFE_PATH);
    expect(noopApi.generateImage).not.toHaveBeenCalled();
  });
});
