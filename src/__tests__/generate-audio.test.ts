import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import OpenAI from 'openai';
import {
  createWavHeader,
  detectAudioFormat,
  wrapPcmInWav,
  assembleBase64AudioChunks,
  handleGenerateAudio,
} from '../tool-handlers/generate-audio.js';
import { replaceExtension } from '../tool-handlers/path-utils.js';
import { handleTextToSpeech } from '../tool-handlers/text-to-speech.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode } from '../errors.js';
import {
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_RESPONSE_FORMAT,
  DEFAULT_TTS_VOICE,
} from '../tts-defaults.js';

function mockAudioStream(chunks: Array<{ data?: string; transcript?: string }>): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(
          (async function* () {
            for (const chunk of chunks) {
              yield { choices: [{ delta: { audio: chunk } }] };
            }
          })(),
        ),
      },
    },
  } as unknown as OpenAI;
}

function pcmChunk(bytes: Buffer): string {
  return bytes.toString('base64');
}

describe('createWavHeader', () => {
  it('produces a 44-byte buffer', () => {
    const header = createWavHeader(1000);
    expect(header.length).toBe(44);
  });

  it('starts with RIFF...WAVE', () => {
    const header = createWavHeader(1000);
    expect(header.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(header.subarray(8, 12).toString('ascii')).toBe('WAVE');
  });

  it('has correct file size field (36 + dataLength)', () => {
    const header = createWavHeader(1000);
    expect(header.readUInt32LE(4)).toBe(36 + 1000);
  });

  it('has PCM format (1)', () => {
    const header = createWavHeader(1000);
    expect(header.readUInt16LE(20)).toBe(1);
  });

  it('has correct data chunk size', () => {
    const header = createWavHeader(2048);
    expect(header.readUInt32LE(40)).toBe(2048);
  });

  it('accepts odd PCM byte lengths in header', () => {
    const header = createWavHeader(101);
    expect(header.readUInt32LE(40)).toBe(101);
  });
});

describe('detectAudioFormat', () => {
  it('detects MP3 with ID3 tag', () => {
    const buf = Buffer.from([0x49, 0x44, 0x33, 0x00, 0x00]);
    expect(detectAudioFormat(buf)).toEqual({ ext: 'mp3', mimeType: 'audio/mpeg' });
  });

  it('detects MP3 frame sync (MPEG1 Layer3 = 0xFF 0xFB)', () => {
    const buf = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    expect(detectAudioFormat(buf)).toEqual({ ext: 'mp3', mimeType: 'audio/mpeg' });
  });

  it('rejects reserved MP3 version bits (0x01)', () => {
    const buf = Buffer.from([0xff, 0xe8, 0x00, 0x00]);
    expect(detectAudioFormat(buf).ext).not.toBe('mp3');
  });

  it('detects WAV (RIFF...WAVE)', () => {
    const buf = Buffer.alloc(12);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(100, 4);
    buf.write('WAVE', 8);
    expect(detectAudioFormat(buf)).toEqual({ ext: 'wav', mimeType: 'audio/wav' });
  });

  it('detects FLAC', () => {
    const buf = Buffer.from('fLaC\x00\x00', 'ascii');
    expect(detectAudioFormat(buf)).toEqual({ ext: 'flac', mimeType: 'audio/flac' });
  });

  it('detects OGG', () => {
    const buf = Buffer.from('OggS\x00\x00', 'ascii');
    expect(detectAudioFormat(buf)).toEqual({ ext: 'ogg', mimeType: 'audio/ogg' });
  });

  it('defaults to pcm for unknown data', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(detectAudioFormat(buf)).toEqual({ ext: 'pcm', mimeType: 'audio/pcm' });
  });

  it('defaults to pcm for empty buffer', () => {
    expect(detectAudioFormat(Buffer.alloc(0)).ext).toBe('pcm');
  });
});

describe('wrapPcmInWav', () => {
  it('prepends 44-byte WAV header', () => {
    const pcm = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const wav = wrapPcmInWav(pcm);
    expect(wav.length).toBe(44 + 4);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
  });

  it('detected as WAV after wrapping', () => {
    const pcm = Buffer.alloc(100);
    const wav = wrapPcmInWav(pcm);
    expect(detectAudioFormat(wav)).toEqual({ ext: 'wav', mimeType: 'audio/wav' });
  });

  it('wraps odd-length PCM without truncation', () => {
    const pcm = Buffer.alloc(101, 0x7f);
    const wav = wrapPcmInWav(pcm);
    expect(wav.length).toBe(44 + 101);
    expect(wav.readUInt32LE(40)).toBe(101);
  });
});

describe('assembleBase64AudioChunks', () => {
  it('returns empty buffer for no chunks', () => {
    expect(assembleBase64AudioChunks([])).toEqual(Buffer.alloc(0));
  });

  it('decodes a single chunk', () => {
    const raw = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(assembleBase64AudioChunks([raw.toString('base64')])).toEqual(raw);
  });

  it('decodes padded multi-chunk streams correctly (join would corrupt)', () => {
    const full = Buffer.alloc(1000, 0x42);
    const chunks: string[] = [];
    for (let i = 0; i < full.length; i += 100) {
      chunks.push(full.subarray(i, i + 100).toString('base64'));
    }
    const joined = chunks.join('');
    expect(Buffer.from(joined, 'base64').equals(full)).toBe(false);
    expect(assembleBase64AudioChunks(chunks).equals(full)).toBe(true);
  });
});

describe('replaceExtension', () => {
  it('replaces existing extension', () => {
    expect(replaceExtension('output.wav', 'mp3')).toBe('output.mp3');
  });

  it('appends extension when none exists', () => {
    expect(replaceExtension('output', 'wav')).toBe('output.wav');
  });

  it('handles nested paths', () => {
    expect(replaceExtension('/tmp/audio/file.wav', 'mp3')).toBe('/tmp/audio/file.mp3');
  });

  it('handles dotfiles', () => {
    expect(replaceExtension('.hidden.wav', 'mp3')).toBe('.hidden.mp3');
  });
});

describe('handleGenerateAudio', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'gen-audio-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('rejects invalid format before upstream call', async () => {
    const openai = mockAudioStream([]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'hi', format: 'aac' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('returns error when stream has transcript but no audio', async () => {
    const openai = mockAudioStream([{ transcript: 'hello only' }]);
    const r = await handleGenerateAudio({ params: { arguments: { prompt: 'hi' } } }, openai);
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('transcript only');
  });

  it('returns error for empty stream', async () => {
    const openai = mockAudioStream([]);
    const r = await handleGenerateAudio({ params: { arguments: { prompt: 'hi' } } }, openai);
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('No audio returned');
  });

  it('assembles multi-chunk PCM stream and inlines WAV under ceiling', async () => {
    const pcm = Buffer.alloc(200, 0x11);
    const openai = mockAudioStream([
      { data: pcmChunk(pcm.subarray(0, 100)) },
      { data: pcmChunk(pcm.subarray(100)) },
      { transcript: 'spoken text' },
    ]);
    const r = await handleGenerateAudio({ params: { arguments: { prompt: 'hi' } } }, openai);
    expect(r.isError).toBeUndefined();
    const audioBlock = r.content.find((c) => c.type === 'audio');
    expect(audioBlock).toBeDefined();
    const decoded = Buffer.from((audioBlock as { data: string }).data, 'base64');
    expect(detectAudioFormat(decoded).ext).toBe('wav');
    expect(decoded.length).toBe(44 + pcm.length);
    expect(r.content.some((c) => c.type === 'text' && c.text.includes('spoken text'))).toBe(true);
  });

  it('writes exactly one file with corrected extension in _meta.save_path', async () => {
    const pcm = Buffer.alloc(64, 0x22);
    const openai = mockAudioStream([{ data: pcmChunk(pcm) }]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'hi', save_path: 'out.mp3' } } },
      openai,
    );
    expect(r.isError).toBeUndefined();
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.type).toBe('text');
    expect(r._meta.save_path).toBe(await fs.realpath(path.join(sandbox, 'out.wav')));
    await expect(fs.readFile(path.join(sandbox, 'out.wav'))).resolves.toBeDefined();
    await expect(fs.access(path.join(sandbox, 'out.mp3'))).rejects.toThrow();
  });

  it('preserves matching save_path extension', async () => {
    const header = createWavHeader(8);
    const wavBody = Buffer.concat([header, Buffer.alloc(8)]);
    const openai = mockAudioStream([{ data: wavBody.toString('base64') }]);
    const r = await handleGenerateAudio(
      { params: { arguments: { prompt: 'hi', save_path: 'speech.wav' } } },
      openai,
    );
    expect(r._meta.save_path).toBe(await fs.realpath(path.join(sandbox, 'speech.wav')));
  });

  it('returns text-only result when audio exceeds inline ceiling', async () => {
    vi.stubEnv('OPENROUTER_AUDIO_INLINE_MAX_BYTES', '4096');
    const pcm = Buffer.alloc(5000, 0x33);
    const openai = mockAudioStream([{ data: pcmChunk(pcm) }]);
    const r = await handleGenerateAudio({ params: { arguments: { prompt: 'hi' } } }, openai);
    expect(r.content.every((c) => c.type === 'text')).toBe(true);
    expect(r.content[0]?.text).toContain('Too large to inline');
    expect(r._meta.save_path).toBeUndefined();
  });
});

describe('handleTextToSpeech', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'tts-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('rejects invalid response_format', async () => {
    const api = { generateSpeech: vi.fn() } as unknown as OpenRouterAPIClient;
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hi', response_format: 'wma' } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(api.generateSpeech).not.toHaveBeenCalled();
  });

  it('uses the verified free model, voice, and mp3 format by default', async () => {
    const api = {
      generateSpeech: vi.fn().mockResolvedValue({
        buffer: Buffer.from('mp3-bytes'),
        contentType: 'audio/mpeg',
      }),
    } as unknown as OpenRouterAPIClient;

    await handleTextToSpeech({ params: { arguments: { input: 'hello' } } }, api);

    expect(api.generateSpeech).toHaveBeenCalledWith(
      {
        model: DEFAULT_TTS_MODEL,
        input: 'hello',
        voice: DEFAULT_TTS_VOICE,
        response_format: DEFAULT_TTS_RESPONSE_FORMAT,
      },
      {},
    );
  });

  it('does not send the default voice with a different model', async () => {
    const api = {
      generateSpeech: vi.fn().mockResolvedValue({
        buffer: Buffer.from('mp3-bytes'),
        contentType: 'audio/mpeg',
      }),
    } as unknown as OpenRouterAPIClient;

    await handleTextToSpeech(
      { params: { arguments: { input: 'hello', model: 'deepgram/aura-2' } } },
      api,
    );

    expect(api.generateSpeech).toHaveBeenCalledWith(
      expect.not.objectContaining({ voice: DEFAULT_TTS_VOICE }),
      {},
    );
  });

  it('rejects response formats unsupported by the dedicated endpoint', async () => {
    const api = { generateSpeech: vi.fn() } as unknown as OpenRouterAPIClient;
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', response_format: 'wav' } } },
      api,
    );

    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(api.generateSpeech).not.toHaveBeenCalled();
  });

  it('inlines audio when save_path unset and under ceiling', async () => {
    const api = {
      generateSpeech: vi.fn().mockResolvedValue({
        buffer: Buffer.from('mp3-bytes'),
        contentType: 'audio/mpeg',
      }),
    } as unknown as OpenRouterAPIClient;
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', response_format: 'mp3' } } },
      api,
    );
    expect(r.content.some((c) => c.type === 'audio')).toBe(true);
    expect(r._meta.save_path).toBeUndefined();
  });

  it('rejects out-of-range speed before upstream call', async () => {
    const api = { generateSpeech: vi.fn() } as unknown as OpenRouterAPIClient;
    const r = await handleTextToSpeech({ params: { arguments: { input: 'hi', speed: 5 } } }, api);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0]?.text).toMatch(/0\.25.*4/);
    expect(api.generateSpeech).not.toHaveBeenCalled();
  });

  it('rejects invalid cache_ttl before upstream call', async () => {
    const api = { generateSpeech: vi.fn() } as unknown as OpenRouterAPIClient;
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hi', cache_ttl: '2d' } } },
      api,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(api.generateSpeech).not.toHaveBeenCalled();
  });

  it('writes one file with detected extension in honest save_path', async () => {
    const wavBody = Buffer.alloc(12);
    wavBody.write('RIFF', 0);
    wavBody.write('WAVE', 8);
    const api = {
      generateSpeech: vi.fn().mockResolvedValue({
        buffer: wavBody,
        contentType: 'audio/pcm',
      }),
    } as unknown as OpenRouterAPIClient;
    const r = await handleTextToSpeech(
      {
        params: {
          arguments: { input: 'hello', response_format: 'pcm', save_path: 'speech.mp3' },
        },
      },
      api,
    );
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.type).toBe('text');
    expect(r._meta.save_path).toBe(await fs.realpath(path.join(sandbox, 'speech.wav')));
    await expect(fs.readFile(path.join(sandbox, 'speech.wav'))).resolves.toEqual(wavBody);
  });

  it('returns too-large hint without writing when save_path unset', async () => {
    vi.stubEnv('OPENROUTER_AUDIO_INLINE_MAX_BYTES', '4096');
    const api = {
      generateSpeech: vi.fn().mockResolvedValue({
        buffer: Buffer.alloc(5000, 0xab),
        contentType: 'audio/mpeg',
      }),
    } as unknown as OpenRouterAPIClient;
    const r = await handleTextToSpeech({ params: { arguments: { input: 'hello' } } }, api);
    expect(r.content.every((c) => c.type === 'text')).toBe(true);
    expect(r.content[0]?.text).toContain('Too large to inline');
    expect(r._meta.save_path).toBeUndefined();
  });
});
