import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { handleAnalyzeImage } from '../tool-handlers/analyze-image.js';
import { handleAnalyzeAudio } from '../tool-handlers/analyze-audio.js';
import { handleAnalyzeVideo } from '../tool-handlers/analyze-video.js';
import { withInputSandbox } from './helpers/input-sandbox.js';

function mockOpenAI(): OpenAI {
  const create = vi.fn();
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

describe('analyze_* local path sandbox (GHSA-3q7p-736f-x44v)', () => {
  it('analyze_image rejects /etc/passwd before calling OpenRouter', async () => {
    const openai = mockOpenAI();
    const r = await handleAnalyzeImage(
      { params: { arguments: { image_path: '/etc/passwd' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UNSAFE_PATH');
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('analyze_image rejects traversal before calling OpenRouter', async () => {
    await withInputSandbox('mcp-analyze-img-', async () => {
      const openai = mockOpenAI();
      const r = await handleAnalyzeImage(
        { params: { arguments: { image_path: '../escape.png' } } },
        openai,
      );
      expect(r.isError).toBe(true);
      expect((r as { _meta: { code: string } })._meta.code).toBe('UNSAFE_PATH');
      expect(openai.chat.completions.create).not.toHaveBeenCalled();
    });
  });

  it('analyze_audio rejects /etc/passwd before calling OpenRouter', async () => {
    const openai = mockOpenAI();
    const r = await handleAnalyzeAudio(
      { params: { arguments: { audio_path: '/etc/passwd' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UNSAFE_PATH');
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('analyze_video rejects /etc/passwd before calling OpenRouter', async () => {
    const openai = mockOpenAI();
    const r = await handleAnalyzeVideo(
      { params: { arguments: { video_path: '/etc/passwd' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UNSAFE_PATH');
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });
});
