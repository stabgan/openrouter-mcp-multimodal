import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import OpenAI from 'openai';
import { handleAnalyzeImage } from '../tool-handlers/analyze-image.js';
import { handleAnalyzeAudio } from '../tool-handlers/analyze-audio.js';
import { handleAnalyzeVideo } from '../tool-handlers/analyze-video.js';
import * as imageUtils from '../tool-handlers/image-utils.js';
import * as videoUtils from '../tool-handlers/video-utils.js';
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

  it('analyze_audio rejects invalid cache_ttl before reading local audio', async () => {
    await withInputSandbox('mcp-analyze-audio-', async (root) => {
      writeFileSync(path.join(root, 'clip.wav'), Buffer.from('RIFFxxxxWAVE'));
      const openai = mockOpenAI();
      const r = await handleAnalyzeAudio(
        { params: { arguments: { audio_path: 'clip.wav', cache_ttl: '2d' } } },
        openai,
      );
      expect(r.isError).toBe(true);
      expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
      expect(openai.chat.completions.create).not.toHaveBeenCalled();
    });
  });

  it('analyze_image rejects invalid cache_ttl before reading local image', async () => {
    await withInputSandbox('mcp-analyze-img-', async (root) => {
      writeFileSync(path.join(root, 'photo.png'), Buffer.from('fake-png'));
      const prepareSpy = vi.spyOn(imageUtils, 'prepareImageUrl');
      const openai = mockOpenAI();
      const r = await handleAnalyzeImage(
        { params: { arguments: { image_path: 'photo.png', cache_ttl: '2d' } } },
        openai,
      );
      expect(r.isError).toBe(true);
      expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
      expect(prepareSpy).not.toHaveBeenCalled();
      expect(openai.chat.completions.create).not.toHaveBeenCalled();
      prepareSpy.mockRestore();
    });
  });

  it('analyze_video rejects invalid cache_ttl before reading local video', async () => {
    await withInputSandbox('mcp-analyze-vid-', async (root) => {
      writeFileSync(path.join(root, 'clip.mp4'), Buffer.from('fake-mp4'));
      const prepareSpy = vi.spyOn(videoUtils, 'prepareVideoData');
      const openai = mockOpenAI();
      const r = await handleAnalyzeVideo(
        { params: { arguments: { video_path: 'clip.mp4', cache_ttl: '2d' } } },
        openai,
      );
      expect(r.isError).toBe(true);
      expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
      expect(prepareSpy).not.toHaveBeenCalled();
      expect(openai.chat.completions.create).not.toHaveBeenCalled();
      prepareSpy.mockRestore();
    });
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
