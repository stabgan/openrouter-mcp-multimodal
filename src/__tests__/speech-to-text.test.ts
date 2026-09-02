import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { handleSpeechToText } from '../tool-handlers/speech-to-text.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode } from '../errors.js';

describe('handleSpeechToText', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'stt-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  function mockApi(text: string): OpenRouterAPIClient {
    return {
      transcribeAudio: vi.fn().mockResolvedValue({ text }),
    } as unknown as OpenRouterAPIClient;
  }

  function wavDataUrl(): string {
    const b64 = Buffer.from('RIFFxxxxWAVE').toString('base64');
    return `data:audio/wav;base64,${b64}`;
  }

  it('rejects invalid response_format before upstream call', async () => {
    const api = mockApi('');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: 'x.wav', response_format: 'xml' } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(api.transcribeAudio).not.toHaveBeenCalled();
  });

  it('rejects out-of-range temperature before upstream call', async () => {
    const api = mockApi('');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl(), temperature: 1.5 } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(api.transcribeAudio).not.toHaveBeenCalled();
  });

  it('returns plain text for response_format text without JSON.parse in handler', async () => {
    const api = mockApi('hello world');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl(), response_format: 'text' } } },
      api,
    );
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toBe('hello world');
  });

  it('returns srt content from text field', async () => {
    const srt = '1\n00:00:00,000 --> 00:00:01,000\nHello\n';
    const api = mockApi(srt);
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl(), response_format: 'srt' } } },
      api,
    );
    expect(r.content[0]?.text).toBe(srt);
  });

  it('returns vtt content from text field', async () => {
    const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n';
    const api = mockApi(vtt);
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl(), response_format: 'vtt' } } },
      api,
    );
    expect(r.content[0]?.text).toBe(vtt);
  });

  it('returns json transcript from text field', async () => {
    const api = mockApi('transcribed');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl(), response_format: 'json' } } },
      api,
    );
    expect(r.content[0]?.text).toBe('transcribed');
  });

  it('passes input_audio with detected format for local wav', async () => {
    const wavPath = path.join(sandbox, 'clip.wav');
    await fs.writeFile(wavPath, Buffer.from('RIFFxxxxWAVE'));
    const api = mockApi('ok');
    await handleSpeechToText({ params: { arguments: { audio_path: 'clip.wav' } } }, api);
    expect(api.transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        input_audio: expect.objectContaining({ format: 'wav' }),
      }),
      {},
    );
  });

  it('rejects unsupported local extension', async () => {
    const txtPath = path.join(sandbox, 'notes.txt');
    await fs.writeFile(txtPath, Buffer.from('not audio'));
    const api = mockApi('');
    const r = await handleSpeechToText({ params: { arguments: { audio_path: 'notes.txt' } } }, api);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UNSUPPORTED_FORMAT);
    expect(api.transcribeAudio).not.toHaveBeenCalled();
  });

  it('rejects oversized local files', async () => {
    vi.stubEnv('OPENROUTER_AUDIO_MAX_DOWNLOAD_BYTES', '16');
    const wavPath = path.join(sandbox, 'big.wav');
    await fs.writeFile(wavPath, Buffer.alloc(32));
    const api = mockApi('');
    const r = await handleSpeechToText({ params: { arguments: { audio_path: 'big.wav' } } }, api);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.RESOURCE_TOO_LARGE);
    expect(api.transcribeAudio).not.toHaveBeenCalled();
  });

  it('rejects unsafe local paths before upstream call', async () => {
    const api = mockApi('');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: '/etc/passwd' } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UNSAFE_PATH);
    expect(api.transcribeAudio).not.toHaveBeenCalled();
  });

  it('accepts data URL audio input', async () => {
    const b64 = Buffer.from('RIFFxxxxWAVE').toString('base64');
    const api = mockApi('from data url');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: `data:audio/wav;base64,${b64}` } } },
      api,
    );
    expect(r.isError).toBeFalsy();
    expect(r.content[0]?.text).toBe('from data url');
    expect(api.transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        input_audio: expect.objectContaining({ format: 'wav' }),
      }),
      {},
    );
  });

  it('rejects oversized data URLs', async () => {
    vi.stubEnv('OPENROUTER_AUDIO_MAX_DOWNLOAD_BYTES', '8');
    const b64 = Buffer.alloc(32).toString('base64');
    const api = mockApi('');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: `data:audio/wav;base64,${b64}` } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.RESOURCE_TOO_LARGE);
    expect(api.transcribeAudio).not.toHaveBeenCalled();
  });

  it('rejects oversized HTTP URL downloads at the shared ceiling', async () => {
    vi.stubEnv('OPENROUTER_AUDIO_MAX_DOWNLOAD_BYTES', '16');
    const fetchSpy = vi.spyOn(await import('../tool-handlers/fetch-utils.js'), 'fetchHttpResource');
    fetchSpy.mockRejectedValue(new Error('Response too large'));
    const api = mockApi('');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: 'https://example.com/big.wav' } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.RESOURCE_TOO_LARGE);
    expect(api.transcribeAudio).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects HTTP URLs when audio format cannot be inferred', async () => {
    const fetchSpy = vi.spyOn(await import('../tool-handlers/fetch-utils.js'), 'fetchHttpResource');
    fetchSpy.mockResolvedValue({
      buffer: Buffer.from('not-audio'),
      contentType: 'application/octet-stream',
    });
    const api = mockApi('');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: 'https://example.com/unknown.bin' } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UNSUPPORTED_FORMAT);
    expect(api.transcribeAudio).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects invalid cache_ttl before upstream call', async () => {
    const api = mockApi('');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl(), cache_ttl: '2d' } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(api.transcribeAudio).not.toHaveBeenCalled();
  });

  it('accepts duration cache_ttl and passes normalized headers upstream', async () => {
    const api = mockApi('ok');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl(), cache: true, cache_ttl: '1h' } } },
      api,
    );
    expect(r.isError).toBeFalsy();
    expect(api.transcribeAudio).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ 'X-OpenRouter-Cache-TTL': '3600' }),
    );
  });

  it('returns verbose_json as formatted JSON text', async () => {
    const verbose = { text: 'hello', segments: [{ start: 0, end: 1, text: 'hello' }] };
    const api = {
      transcribeAudio: vi.fn().mockResolvedValue(verbose),
    } as unknown as OpenRouterAPIClient;
    const r = await handleSpeechToText(
      {
        params: {
          arguments: { audio_path: wavDataUrl(), response_format: 'verbose_json' },
        },
      },
      api,
    );
    expect(r.content[0]?.text).toBe(JSON.stringify(verbose, null, 2));
  });
});
