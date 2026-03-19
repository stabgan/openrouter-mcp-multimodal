import { describe, it, expect, beforeAll } from 'vitest';
import { config } from 'dotenv';
import OpenAI from 'openai';
import { handleChatCompletion } from '../tool-handlers/chat-completion.js';
import { handleAnalyzeImage } from '../tool-handlers/analyze-image.js';
import { handleSearchModels } from '../tool-handlers/search-models.js';
import { handleGetModelInfo } from '../tool-handlers/get-model-info.js';
import { handleValidateModel } from '../tool-handlers/validate-model.js';
import { OpenRouterAPIClient } from '../openrouter-api.js';
import { ModelCache } from '../model-cache.js';
import path from 'path';

config(); // Load .env

const API_KEY = process.env.OPENROUTER_API_KEY;
const DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

// Skip all integration tests if no API key
const describeIf = API_KEY ? describe : describe.skip;

describeIf('Integration: chat_completion', () => {
  let openai: OpenAI;

  beforeAll(() => {
    openai = new OpenAI({ apiKey: API_KEY, baseURL: 'https://openrouter.ai/api/v1' });
  });

  it('should complete a simple text chat', async () => {
    const result = await handleChatCompletion(
      {
        params: {
          arguments: { messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }] },
        },
      },
      openai,
      DEFAULT_MODEL,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.toLowerCase()).toContain('hello');
  });

  it('should return error for empty messages', async () => {
    const result = await handleChatCompletion(
      { params: { arguments: { messages: [] } } },
      openai,
      DEFAULT_MODEL,
    );
    expect(result.isError).toBe(true);
  });
});

describeIf('Integration: analyze_image', () => {
  let openai: OpenAI;

  beforeAll(() => {
    openai = new OpenAI({ apiKey: API_KEY, baseURL: 'https://openrouter.ai/api/v1' });
  });

  it('should analyze the test image from file path', async () => {
    const testImg = path.resolve('test.png');
    const result = await handleAnalyzeImage(
      { params: { arguments: { image_path: testImg, question: 'Describe this image briefly.' } } },
      openai,
      DEFAULT_MODEL,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.length).toBeGreaterThan(10);
  });

  it('should analyze an image from URL', async () => {
    const result = await handleAnalyzeImage(
      {
        params: {
          arguments: {
            image_path:
              'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png',
            question: 'What do you see?',
          },
        },
      },
      openai,
      DEFAULT_MODEL,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text.length).toBeGreaterThan(10);
  });

  it('should return error for missing image_path', async () => {
    const result = await handleAnalyzeImage(
      { params: { arguments: { image_path: '' } } },
      openai,
      DEFAULT_MODEL,
    );
    expect(result.isError).toBe(true);
  });
});

describeIf('Integration: search_models', () => {
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
    const models = JSON.parse(result.content[0].text);
    expect(models.length).toBeGreaterThan(0);
    expect(models.length).toBeLessThanOrEqual(5);
  });

  it('should filter by vision capability', async () => {
    const result = await handleSearchModels(
      { params: { arguments: { capabilities: { vision: true }, limit: 3 } } },
      apiClient,
      cache,
    );
    const models = JSON.parse(result.content[0].text);
    expect(
      models.every((m: { architecture?: { input_modalities?: string[] } }) =>
        m.architecture?.input_modalities?.includes('image'),
      ),
    ).toBe(true);
  });
});

describeIf('Integration: get_model_info + validate_model', () => {
  let apiClient: OpenRouterAPIClient;
  let cache: ModelCache;

  beforeAll(async () => {
    apiClient = new OpenRouterAPIClient(API_KEY!);
    cache = ModelCache.getInstance();
  });

  it('should get info for a known model', async () => {
    const result = await handleGetModelInfo(
      { params: { arguments: { model: DEFAULT_MODEL } } },
      cache,
      apiClient,
    );
    expect(result.isError).toBeFalsy();
    const info = JSON.parse(result.content[0].text);
    expect(info.id).toBe(DEFAULT_MODEL);
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
      { params: { arguments: { model: DEFAULT_MODEL } } },
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
