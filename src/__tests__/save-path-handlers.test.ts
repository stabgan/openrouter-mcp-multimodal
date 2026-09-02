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
import * as fetchUtils from '../tool-handlers/fetch-utils.js';

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

  it('text_to_speech saves with extension matching detected bytes (WAV not mp3)', async () => {
    const wavBody = Buffer.alloc(12);
    wavBody.write('RIFF', 0);
    wavBody.write('WAVE', 8);
    const api = {
      generateSpeech: vi.fn().mockResolvedValue({
        buffer: wavBody,
        contentType: 'audio/mpeg',
      }),
    } as unknown as OpenRouterAPIClient;

    const r = await handleTextToSpeech(
      {
        params: {
          arguments: { input: 'hello', save_path: 'speech.mp3', response_format: 'mp3' },
        },
      },
      api,
    );

    expect(r.isError).toBeUndefined();
    const wavPath = path.join(sandbox, 'speech.wav');
    await expect(fs.access(wavPath)).resolves.toBeUndefined();
    expect(path.basename(String(r._meta.save_path))).toBe('speech.wav');
    await expect(fs.readFile(String(r._meta.save_path))).resolves.toEqual(wavBody);
  });

  it('generate_image_dedicated downloads URL when save_path set and no b64_json', async () => {
    const api = {
      generateImage: vi.fn().mockResolvedValue({
        data: [{ url: 'https://example.com/generated.png' }],
      }),
    } as unknown as OpenRouterAPIClient;

    vi.spyOn(fetchUtils, 'fetchHttpResource').mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      contentType: 'image/png',
    });

    const outPath = path.join(sandbox, 'out.png');
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a cat', save_path: 'out.png' } } },
      api,
    );

    expect(fetchUtils.fetchHttpResource).toHaveBeenCalledWith(
      'https://example.com/generated.png',
      expect.objectContaining({ maxRedirects: 3 }),
    );
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.type).toBe('text');
    await expect(fs.readFile(outPath)).resolves.toEqual(Buffer.from('png-bytes'));
  });

  it('generate_image_dedicated falls back to URL when b64_json is empty', async () => {
    const api = {
      generateImage: vi.fn().mockResolvedValue({
        data: [{ b64_json: '', url: 'https://example.com/generated.png' }],
      }),
    } as unknown as OpenRouterAPIClient;

    vi.spyOn(fetchUtils, 'fetchHttpResource').mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      contentType: 'image/png',
    });

    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a cat', save_path: 'out.png' } } },
      api,
    );

    expect(fetchUtils.fetchHttpResource).toHaveBeenCalled();
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.type).toBe('text');
  });

  it('generate_image_dedicated rejects invalid aspect_ratio before API call', async () => {
    const api = { generateImage: vi.fn() } as unknown as OpenRouterAPIClient;
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a dot', aspect_ratio: '99:1' } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(api.generateImage).not.toHaveBeenCalled();
  });

  it('generate_image_dedicated rejects n above schema maximum before API call', async () => {
    const api = { generateImage: vi.fn() } as unknown as OpenRouterAPIClient;
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a dot', n: 11 } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(api.generateImage).not.toHaveBeenCalled();
  });

  it('generate_image_dedicated rejects invalid cache_ttl before API call', async () => {
    const api = { generateImage: vi.fn() } as unknown as OpenRouterAPIClient;
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a dot', cache_ttl: '2d' } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(api.generateImage).not.toHaveBeenCalled();
  });

  it('generate_image_dedicated reports images_count and saved_image_index for n>1', async () => {
    const api = {
      generateImage: vi.fn().mockResolvedValue({
        data: [
          { b64_json: Buffer.from('first').toString('base64') },
          { b64_json: Buffer.from('second').toString('base64') },
        ],
      }),
    } as unknown as OpenRouterAPIClient;

    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'two cats', n: 2 } } },
      api,
    );

    expect(r.isError).toBeFalsy();
    expect(r._meta.images_count).toBe(2);
    expect(r._meta.saved_image_index).toBe(0);
    expect(r._meta.images_note).toMatch(/images\[0\]/);
    expect(r.content[0]?.type).toBe('image');
    expect(r.content[0]?.data).toBe(Buffer.from('first').toString('base64'));
  });

  it('generate_image_dedicated does not leave a truncated file when URL download fails', async () => {
    const api = {
      generateImage: vi.fn().mockResolvedValue({
        data: [{ url: 'https://example.com/generated.png' }],
      }),
    } as unknown as OpenRouterAPIClient;

    vi.spyOn(fetchUtils, 'fetchHttpResource').mockRejectedValue(new Error('network down'));

    const outPath = path.join(sandbox, 'should-not-exist.png');
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a cat', save_path: 'should-not-exist.png' } } },
      api,
    );

    expect(r.isError).toBe(true);
    await expect(fs.access(outPath)).rejects.toBeDefined();
  });

  it('generate_image_dedicated rejects empty URL download body for save_path', async () => {
    const api = {
      generateImage: vi.fn().mockResolvedValue({
        data: [{ url: 'https://example.com/empty.png' }],
      }),
    } as unknown as OpenRouterAPIClient;

    vi.spyOn(fetchUtils, 'fetchHttpResource').mockResolvedValue({
      buffer: Buffer.alloc(0),
      contentType: 'image/png',
    });

    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a cat', save_path: 'out.png' } } },
      api,
    );

    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UPSTREAM_REFUSED);
    await expect(fs.access(path.join(sandbox, 'out.png'))).rejects.toBeDefined();
  });

  it('generate_image_dedicated rejects input_references when one entry fails mid-flight', async () => {
    const api = { generateImage: vi.fn() } as unknown as OpenRouterAPIClient;
    const r = await handleGenerateImageDedicated(
      {
        params: {
          arguments: {
            prompt: 'blend',
            input_references: ['https://example.com/a.png', '   '],
          },
        },
      },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(api.generateImage).not.toHaveBeenCalled();
  });
});
