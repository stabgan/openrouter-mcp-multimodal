import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { handleAnalyzeVideo } from '../tool-handlers/analyze-video.js';
import { withInputSandbox } from './helpers/input-sandbox.js';
import type OpenAI from 'openai';

const MP4_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x20]),
  Buffer.from('ftyp', 'ascii'),
  Buffer.from('isom', 'ascii'),
  Buffer.alloc(32),
]);

function mockOpenAI(responseText: string) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: responseText } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  });
  const openai = { chat: { completions: { create } } } as unknown as OpenAI;
  return { openai, create };
}

async function withMp4File<T>(fn: (relPath: string) => Promise<T>): Promise<T> {
  return withInputSandbox('mcp-analyze-video-', async (root) => {
    writeFileSync(path.join(root, 'clip.mp4'), MP4_BYTES);
    return fn('clip.mp4');
  });
}

describe('handleAnalyzeVideo', () => {
  it('returns an INVALID_INPUT error when video_path is missing', async () => {
    const { openai } = mockOpenAI('ignored');
    const r = await handleAnalyzeVideo({ params: { arguments: { video_path: '' } } }, openai);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('sends a video_url content part with base64 payload', async () => {
    await withMp4File(async (file) => {
      const { openai, create } = mockOpenAI('A short test clip.');
      const r = await handleAnalyzeVideo(
        { params: { arguments: { video_path: file, question: 'What is this?' } } },
        openai,
      );
      expect(r.isError).toBeFalsy();
      expect(create).toHaveBeenCalledOnce();
      const call = create.mock.calls[0]![0];
      const content = call.messages[0].content;
      expect(Array.isArray(content)).toBe(true);
      const videoPart = content[1];
      expect(videoPart.type).toBe('video_url');
      expect(videoPart.video_url.url.startsWith('data:video/mp4;base64,')).toBe(true);
    });
  });

  it('uses OPENROUTER_DEFAULT_VIDEO_MODEL when set', async () => {
    vi.stubEnv('OPENROUTER_DEFAULT_VIDEO_MODEL', 'custom/video-model');
    await withMp4File(async (file) => {
      const { openai, create } = mockOpenAI('ok');
      await handleAnalyzeVideo({ params: { arguments: { video_path: file } } }, openai);
      const call = create.mock.calls[0]![0];
      expect(call.model).toBe('custom/video-model');
    });
    vi.unstubAllEnvs();
  });

  it('falls back to google/gemini-2.5-flash when nothing is set', async () => {
    await withMp4File(async (file) => {
      const { openai, create } = mockOpenAI('ok');
      await handleAnalyzeVideo({ params: { arguments: { video_path: file } } }, openai);
      const call = create.mock.calls[0]![0];
      expect(call.model).toBe('google/gemini-2.5-flash');
    });
  });

  it('attaches usage metadata', async () => {
    await withMp4File(async (file) => {
      const { openai } = mockOpenAI('summary');
      const r = await handleAnalyzeVideo({ params: { arguments: { video_path: file } } }, openai);
      expect((r as { _meta: { usage?: { total_tokens: number } } })._meta.usage?.total_tokens).toBe(
        120,
      );
    });
  });

  it('maps unsupported formats to UNSUPPORTED_FORMAT', async () => {
    await withInputSandbox('mcp-analyze-video-', async (root) => {
      writeFileSync(path.join(root, 'clip.avi'), Buffer.from('unknown-bytes'));
      const { openai } = mockOpenAI('ignored');
      const r = await handleAnalyzeVideo(
        { params: { arguments: { video_path: 'clip.avi' } } },
        openai,
      );
      expect(r.isError).toBe(true);
      expect((r as { _meta: { code: string } })._meta.code).toBe('UNSUPPORTED_FORMAT');
    });
  });
});
