/**
 * Mock validation layer — every tool handler rejects bad input before upstream calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OpenAI from 'openai';
import { handleChatCompletion } from '../../tool-handlers/chat-completion.js';
import { handleAnalyzeImage } from '../../tool-handlers/analyze-image.js';
import { handleAnalyzeAudio } from '../../tool-handlers/analyze-audio.js';
import { handleAnalyzeVideo } from '../../tool-handlers/analyze-video.js';
import { handleGenerateImage } from '../../tool-handlers/generate-image.js';
import { handleGenerateAudio } from '../../tool-handlers/generate-audio.js';
import {
  handleGenerateVideo,
  handleGetVideoStatus,
  handleGenerateVideoFromImage,
} from '../../tool-handlers/generate-video.js';
import { handleRerankDocuments } from '../../tool-handlers/rerank.js';
import { handleValidateModel } from '../../tool-handlers/validate-model.js';
import { handleGetModelInfo } from '../../tool-handlers/get-model-info.js';
import { handleHealthCheck } from '../../tool-handlers/health-check.js';
import { ModelCache } from '../../model-cache.js';
import type { OpenRouterAPIClient } from '../../openrouter-api.js';

function mockOpenAI(): OpenAI {
  const create = vi.fn();
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const noopApi = {} as OpenRouterAPIClient;

describe('mock strata: handler INVALID_INPUT guards', () => {
  beforeEach(() => {
    ModelCache.getInstance().reset();
  });

  it('chat_completion rejects empty messages array', async () => {
    const r = await handleChatCompletion({ params: { arguments: { messages: [] } } }, mockOpenAI());
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  const blankPathCases = ['', '   ', '\t'];
  it.each([''])('analyze_image rejects blank image_path %j', async (p) => {
    const r = await handleAnalyzeImage({ params: { arguments: { image_path: p } } }, mockOpenAI());
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it.each([''])('analyze_audio rejects blank audio_path %j', async (p) => {
    const r = await handleAnalyzeAudio({ params: { arguments: { audio_path: p } } }, mockOpenAI());
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it.each(blankPathCases)('analyze_video rejects blank video_path %j', async (p) => {
    const r = await handleAnalyzeVideo({ params: { arguments: { video_path: p } } }, mockOpenAI());
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  const blankPromptCases = ['', '   ', '\n'];
  it.each(blankPromptCases)('generate_image rejects blank prompt %j', async (prompt) => {
    const r = await handleGenerateImage({ params: { arguments: { prompt } } }, mockOpenAI());
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it.each(blankPromptCases)('generate_audio rejects blank prompt %j', async (prompt) => {
    const r = await handleGenerateAudio({ params: { arguments: { prompt } } }, mockOpenAI());
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it.each(blankPromptCases)('generate_video rejects blank prompt %j', async (prompt) => {
    const r = await handleGenerateVideo({ params: { arguments: { prompt } } }, noopApi);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it.each([''])('validate_model rejects blank model %j', async (model) => {
    const cache = ModelCache.getInstance();
    const r = await handleValidateModel({ params: { arguments: { model } } }, cache);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it.each([''])('get_model_info rejects blank model %j', async (model) => {
    const cache = ModelCache.getInstance();
    const r = await handleGetModelInfo({ params: { arguments: { model } } }, cache, noopApi);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it.each(['', '   '])('get_video_status rejects blank video_id %j', async (video_id) => {
    const r = await handleGetVideoStatus({ params: { arguments: { video_id } } }, noopApi);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  const missingImageCases = [
    { image: '', prompt: 'move' },
    { image: 'a.png', prompt: '' },
    { image: 'a.png', prompt: '   ' },
  ];
  it.each(missingImageCases)('generate_video_from_image rejects %j', async (args) => {
    const r = await handleGenerateVideoFromImage({ params: { arguments: args } }, noopApi);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  const rerankCases: Array<[string, { query?: string; documents?: unknown[] }]> = [
    ['empty query', { query: '', documents: ['a'] }],
    ['whitespace query', { query: '  ', documents: ['a'] }],
    ['empty documents', { query: 'q', documents: [] }],
    ['missing documents', { query: 'q', documents: undefined as unknown as string[] }],
    ['non-string doc', { query: 'q', documents: [{ text: 'x' } as unknown as string] }],
    ['mixed types', { query: 'q', documents: ['ok', 1 as unknown as string] }],
  ];
  it.each(rerankCases)('rerank_documents rejects %s', async (_label, args) => {
    const r = await handleRerankDocuments({ params: { arguments: args as never } }, noopApi);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('health_check succeeds with empty args (never INVALID_INPUT)', async () => {
    const cache = ModelCache.getInstance();
    cache.setModels([{ id: 'test/model' }]);
    const api = {
      getModels: vi.fn().mockResolvedValue([{ id: 'test/model' }]),
    } as unknown as OpenRouterAPIClient;
    const r = await handleHealthCheck({ params: { arguments: {} } }, api, cache);
    expect(r.isError).toBeFalsy();
  });
});
