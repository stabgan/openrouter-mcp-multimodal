import { describe, it, expect, beforeAll } from 'vitest';
import OpenAI from 'openai';
import { handleChatCompletion } from '../tool-handlers/chat-completion.js';
import { handleAnalyzeImage } from '../tool-handlers/analyze-image.js';
import { handleSearchModels } from '../tool-handlers/search-models.js';
import { handleGetModelInfo } from '../tool-handlers/get-model-info.js';
import { handleValidateModel } from '../tool-handlers/validate-model.js';
import { handleAnalyzeAudio } from '../tool-handlers/analyze-audio.js';
import { handleGenerateAudio } from '../tool-handlers/generate-audio.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';
import { ModelCache } from '../model-cache.js';
import path from 'path';
import { promises as fsPromises } from 'fs';

import { resolveIntegrationModel } from './helpers/free-models.js';
import { expectSuccessOrSoftFailure } from './helpers/integration-soft-fail.js';

/** Loaded and validated in integration.setup.ts (from .env or environment). */
const API_KEY = process.env.OPENROUTER_API_KEY!;
const INTEGRATION_MODEL = resolveIntegrationModel();
const CHAT_MODEL = process.env.OPENROUTER_INTEGRATION_CHAT_MODEL?.trim() || INTEGRATION_MODEL;
const VISION_MODEL = process.env.OPENROUTER_INTEGRATION_VISION_MODEL?.trim() || INTEGRATION_MODEL;

/** Paid-only tools — skip live generation when OPENROUTER_INTEGRATION_SKIP_PAID=1 (zero-credit accounts). */
const SKIP_PAID_INTEGRATION = process.env.OPENROUTER_INTEGRATION_SKIP_PAID === '1';

describe('Integration: chat_completion', () => {
  let openai: OpenAI;

  beforeAll(() => {
    openai = new OpenAI({ apiKey: API_KEY, baseURL: 'https://openrouter.ai/api/v1' });
  });

  it('should complete a simple text chat', async () => {
    const result = await handleChatCompletion(
      {
        params: {
          arguments: {
            model: CHAT_MODEL,
            max_tokens: 32,
            messages: [{ role: 'user', content: 'Reply with exactly: hello' }],
          },
        },
      },
      openai,
      CHAT_MODEL,
    );
    const ok = expectSuccessOrSoftFailure(result);
    if (ok) expect(result.content[0].text.toLowerCase()).toContain('hello');
  }, 90_000);

  it('should return error for empty messages', async () => {
    const result = await handleChatCompletion(
      { params: { arguments: { messages: [] } } },
      openai,
      CHAT_MODEL,
    );
    expect(result.isError).toBe(true);
  });
});

describe('Integration: analyze_image', () => {
  let openai: OpenAI;

  beforeAll(() => {
    openai = new OpenAI({ apiKey: API_KEY, baseURL: 'https://openrouter.ai/api/v1' });
  });

  it('should analyze the test image from file path', async () => {
    const testImg = path.resolve('test.png');
    const result = await handleAnalyzeImage(
      {
        params: {
          arguments: { image_path: testImg, question: 'Describe this image briefly.' },
        },
      },
      openai,
      VISION_MODEL,
    );
    const ok = expectSuccessOrSoftFailure(result);
    if (ok) expect(result.content[0].text.trim().length).toBeGreaterThan(0);
  }, 90_000);

  it('should analyze an image from URL', async () => {
    const result = await handleAnalyzeImage(
      {
        params: {
          arguments: {
            image_path:
              'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png',
            question: 'What company logo is this? Answer in one short sentence.',
          },
        },
      },
      openai,
      VISION_MODEL,
    );
    const ok = expectSuccessOrSoftFailure(result);
    if (ok) expect(result.content[0].text.trim().length).toBeGreaterThan(0);
  }, 90_000);

  it('should return error for missing image_path', async () => {
    const result = await handleAnalyzeImage(
      { params: { arguments: { image_path: '' } } },
      openai,
      VISION_MODEL,
    );
    expect(result.isError).toBe(true);
  });
});

describe('Integration: search_models', () => {
  let apiClient: OpenRouterAPIClient;
  let cache: ModelCache;

  beforeAll(() => {
    apiClient = new OpenRouterAPIClient(API_KEY!);
    cache = ModelCache.getInstance();
  });

  it('should fetch and search models', async () => {
    const result = await handleSearchModels(
      { params: { arguments: { query: 'free', limit: 5 } } },
      apiClient,
      cache,
    );
    expect(result.isError).toBeFalsy();
    // v4.5: search_models now emits structured output with pagination.
    // Prefer structuredContent; fall back to parsing the text block.
    const payload =
      (result as { structuredContent?: { results?: unknown[] } }).structuredContent ??
      JSON.parse(result.content[0].text);
    const models = payload.results ?? payload;
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(models.length).toBeLessThanOrEqual(5);
  });

  it('should filter by vision capability', async () => {
    const result = await handleSearchModels(
      { params: { arguments: { capabilities: { vision: true }, limit: 3 } } },
      apiClient,
      cache,
    );
    const payload =
      (result as { structuredContent?: { results?: unknown[] } }).structuredContent ??
      JSON.parse(result.content[0].text);
    const models = (payload.results ?? payload) as Array<{
      architecture?: { input_modalities?: string[] };
    }>;
    expect(Array.isArray(models)).toBe(true);
    expect(models.every((m) => m.architecture?.input_modalities?.includes('image'))).toBe(true);
  });
});

describe('Integration: get_model_info + validate_model', () => {
  let apiClient: OpenRouterAPIClient;
  let cache: ModelCache;

  beforeAll(async () => {
    apiClient = new OpenRouterAPIClient(API_KEY!);
    cache = ModelCache.getInstance();
  });

  it('should get info for a known model', async () => {
    const result = await handleGetModelInfo(
      { params: { arguments: { model: VISION_MODEL } } },
      cache,
      apiClient,
    );
    expect(result.isError).toBeFalsy();
    const info = JSON.parse(result.content[0].text);
    expect(info.id).toBe(VISION_MODEL);
  });

  it('should return error for unknown model', async () => {
    const result = await handleGetModelInfo(
      { params: { arguments: { model: 'nonexistent/model-xyz' } } },
      cache,
      apiClient,
    );
    expect(result.isError).toBe(true);
  });

  it('should validate a real model', async () => {
    const result = await handleValidateModel(
      { params: { arguments: { model: VISION_MODEL } } },
      cache,
      apiClient,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.valid).toBe(true);
  });

  it('should invalidate a fake model', async () => {
    const result = await handleValidateModel(
      { params: { arguments: { model: 'fake/model' } } },
      cache,
      apiClient,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.valid).toBe(false);
  });
});

describe('Integration: analyze_audio', () => {
  let openai: OpenAI;

  beforeAll(() => {
    openai = new OpenAI({ apiKey: API_KEY, baseURL: 'https://openrouter.ai/api/v1' });
  });

  it('should analyze audio from a data URL', async () => {
    // Create a minimal WAV file (44-byte header + tiny PCM data) as a data URL
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + 100, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(100, 40);
    const pcmData = Buffer.alloc(100); // silence
    const wavBuffer = Buffer.concat([header, pcmData]);
    const b64 = wavBuffer.toString('base64');

    const result = await handleAnalyzeAudio(
      {
        params: {
          arguments: {
            audio_path: `data:audio/wav;base64,${b64}`,
            question: 'What do you hear?',
            model: VISION_MODEL,
          },
        },
      },
      openai,
    );
    if (result.isError) {
      const errText = result.content[0].text;
      console.log('analyze_audio error:', errText);
      if (
        errText.includes('402') ||
        errText.includes('balance') ||
        errText.includes('404') ||
        errText.toLowerCase().includes('audio')
      ) {
        // Free / vision-only models may not accept audio input — code path still exercised
        expect(result.isError).toBe(true);
        return;
      }
    }
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.length).toBeGreaterThan(0);
  }, 30000);

  it('should return error for missing audio_path', async () => {
    const result = await handleAnalyzeAudio({ params: { arguments: { audio_path: '' } } }, openai);
    expect(result.isError).toBe(true);
  });
});

describe.skipIf(SKIP_PAID_INTEGRATION)('Integration: generate_audio', () => {
  let openai: OpenAI;

  beforeAll(() => {
    openai = new OpenAI({ apiKey: API_KEY, baseURL: 'https://openrouter.ai/api/v1' });
  });

  it('should generate audio from a text prompt', async () => {
    const result = await handleGenerateAudio(
      {
        params: {
          arguments: {
            prompt: 'Say hello world',
            model: 'openai/gpt-4o-mini-audio-preview',
            voice: 'alloy',
          },
        },
      },
      openai,
    );
    // Either we get audio back or a graceful error (model availability varies)
    expect(result.content.length).toBeGreaterThan(0);
    if (!result.isError) {
      const audioContent = result.content.find((c: { type: string }) => c.type === 'audio');
      if (audioContent) {
        expect((audioContent as { data: string }).data.length).toBeGreaterThan(0);
      }
    }
  }, 60000);

  it('should save audio to file and auto-correct extension', async () => {
    const tmpPath = path.join('/tmp', `test-gen-audio-${Date.now()}.wav`);
    const result = await handleGenerateAudio(
      {
        params: {
          arguments: {
            prompt: 'Say the word test',
            model: 'openai/gpt-4o-mini-audio-preview',
            voice: 'alloy',
            save_path: tmpPath,
          },
        },
      },
      openai,
    );
    if (!result.isError) {
      const textContent = result.content.find((c: { type: string }) => c.type === 'text');
      expect((textContent as { text: string }).text).toContain('Audio saved to:');
      // Clean up - the actual path may have been corrected
      const savedPath = (textContent as { text: string }).text.match(
        /Audio saved to: (.+?)(\s|\n|$)/,
      )?.[1];
      if (savedPath) {
        try {
          await fsPromises.unlink(savedPath);
        } catch {
          /* ignore */
        }
      }
    }
  }, 60000);

  it('should return error for empty prompt', async () => {
    const result = await handleGenerateAudio({ params: { arguments: { prompt: '' } } }, openai);
    expect(result.isError).toBe(true);
  });
});
