import { describe, it, expect, vi } from 'vitest';
import {
  getAudioFormat,
  getAudioMimeType,
  prepareAudioData,
  resolveSpeechToTextAudio,
  getMaxAudioInputBytes,
  detectAudioFormat,
  isBlockedIPv4,
  assertUrlSafeForFetch,
  SUPPORTED_AUDIO_FORMATS,
} from '../tool-handlers/audio-utils.js';
import { UnsafeOutputPathError } from '../tool-handlers/path-safety.js';
import { withInputSandbox } from './helpers/input-sandbox.js';
import path from 'path';
import { writeFileSync } from 'fs';

describe('detectAudioFormat', () => {
  it('detects MP3 with ID3 tag', () => {
    const buf = Buffer.from([0x49, 0x44, 0x33, 0x00, 0x00]);
    expect(detectAudioFormat(buf)).toEqual({ ext: 'mp3', mimeType: 'audio/mpeg' });
  });

  it('detects WAV (RIFF...WAVE)', () => {
    const buf = Buffer.alloc(12);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(100, 4);
    buf.write('WAVE', 8);
    expect(detectAudioFormat(buf)).toEqual({ ext: 'wav', mimeType: 'audio/wav' });
  });
});

describe('getMaxAudioInputBytes', () => {
  it('defaults to 25 MiB', () => {
    expect(getMaxAudioInputBytes()).toBe(25 * 1024 * 1024);
  });
});

describe('resolveSpeechToTextAudio', () => {
  it('uses the shared byte ceiling for data URLs', async () => {
    vi.stubEnv('OPENROUTER_AUDIO_MAX_DOWNLOAD_BYTES', '8');
    const b64 = Buffer.alloc(32).toString('base64');
    await expect(resolveSpeechToTextAudio(`data:audio/wav;base64,${b64}`)).rejects.toThrow(
      /too large/i,
    );
    vi.unstubAllEnvs();
  });

  it('rejects HTTP URLs when audio format cannot be inferred', async () => {
    const fetchSpy = vi.spyOn(await import('../tool-handlers/fetch-utils.js'), 'fetchHttpResource');
    fetchSpy.mockResolvedValue({
      buffer: Buffer.from('not-audio'),
      contentType: 'application/octet-stream',
    });
    await expect(resolveSpeechToTextAudio('https://example.com/unknown.bin')).rejects.toThrow(
      /Unsupported audio format/i,
    );
    fetchSpy.mockRestore();
  });
});

describe('getAudioFormat', () => {
  it('returns correct format for supported extensions', () => {
    expect(getAudioFormat('audio.wav')).toBe('wav');
    expect(getAudioFormat('audio.mp3')).toBe('mp3');
    expect(getAudioFormat('audio.flac')).toBe('flac');
    expect(getAudioFormat('audio.ogg')).toBe('ogg');
    expect(getAudioFormat('audio.aac')).toBe('aac');
    expect(getAudioFormat('audio.m4a')).toBe('m4a');
    expect(getAudioFormat('audio.aiff')).toBe('aiff');
  });

  it('returns undefined for unsupported extensions', () => {
    expect(getAudioFormat('audio.xyz')).toBeUndefined();
    expect(getAudioFormat('audio.mid')).toBeUndefined();
    expect(getAudioFormat('noext')).toBeUndefined();
  });

  it('returns undefined for API-only formats (pcm16/pcm24 are not file extensions)', () => {
    expect(getAudioFormat('audio.pcm16')).toBeUndefined();
    expect(getAudioFormat('audio.pcm24')).toBeUndefined();
  });

  it('handles uppercase extensions', () => {
    expect(getAudioFormat('audio.WAV')).toBe('wav');
    expect(getAudioFormat('audio.MP3')).toBe('mp3');
    expect(getAudioFormat('audio.FLAC')).toBe('flac');
  });
});

describe('getAudioMimeType', () => {
  it('returns correct MIME types', () => {
    expect(getAudioMimeType('wav')).toBe('audio/wav');
    expect(getAudioMimeType('mp3')).toBe('audio/mpeg');
    expect(getAudioMimeType('flac')).toBe('audio/flac');
    expect(getAudioMimeType('ogg')).toBe('audio/ogg');
    expect(getAudioMimeType('aac')).toBe('audio/aac');
    expect(getAudioMimeType('m4a')).toBe('audio/mp4');
    expect(getAudioMimeType('aiff')).toBe('audio/aiff');
    expect(getAudioMimeType('pcm16')).toBe('audio/pcm');
    expect(getAudioMimeType('pcm24')).toBe('audio/pcm');
  });
});

describe('SUPPORTED_AUDIO_FORMATS', () => {
  it('includes file formats and API formats', () => {
    expect(SUPPORTED_AUDIO_FORMATS).toContain('wav');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('mp3');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('flac');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('ogg');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('aac');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('m4a');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('pcm16');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('pcm24');
  });
});

describe('prepareAudioData', () => {
  it('decodes base64 data URLs with correct format', async () => {
    const audioData = Buffer.from('fake-audio-data').toString('base64');
    const result = await prepareAudioData(`data:audio/wav;base64,${audioData}`);
    expect(result.data).toBe(audioData);
    expect(result.format).toBe('wav');
  });

  it('maps audio/mpeg MIME to mp3 format', async () => {
    const audioData = Buffer.from('fake-audio-data').toString('base64');
    const result = await prepareAudioData(`data:audio/mpeg;base64,${audioData}`);
    expect(result.data).toBe(audioData);
    expect(result.format).toBe('mp3');
  });

  it('rejects invalid data URLs', async () => {
    await expect(prepareAudioData('data:invalid')).rejects.toThrow('Invalid data URL');
  });

  it('rejects unsupported MIME types', async () => {
    const audioData = Buffer.from('fake').toString('base64');
    await expect(prepareAudioData(`data:audio/xyz;base64,${audioData}`)).rejects.toThrow(
      'Unsupported audio format',
    );
  });

  it('reads local files and returns base64 with format', async () => {
    await withInputSandbox('mcp-audio-', async (root) => {
      writeFileSync(path.join(root, 'clip.wav'), Buffer.from('fake-audio-content'));
      const result = await prepareAudioData('clip.wav');
      expect(result.data).toBe(Buffer.from('fake-audio-content').toString('base64'));
      expect(result.format).toBe('wav');
    });
  });

  it('rejects oversized local files at the shared byte ceiling', async () => {
    await withInputSandbox('mcp-audio-', async (root) => {
      vi.stubEnv('OPENROUTER_AUDIO_MAX_DOWNLOAD_BYTES', '16');
      writeFileSync(path.join(root, 'big.wav'), Buffer.alloc(32));
      await expect(prepareAudioData('big.wav')).rejects.toThrow(/too large/i);
      vi.unstubAllEnvs();
    });
  });

  it('throws on missing files inside the sandbox', async () => {
    await withInputSandbox('mcp-audio-', async () => {
      await expect(prepareAudioData('missing.wav')).rejects.toThrow();
    });
  });

  it('rejects paths outside the sandbox', async () => {
    await withInputSandbox('mcp-audio-', async () => {
      await expect(prepareAudioData('/etc/passwd')).rejects.toBeInstanceOf(UnsafeOutputPathError);
    });
  });

  it('throws on unsupported file extensions', async () => {
    await withInputSandbox('mcp-audio-', async (root) => {
      writeFileSync(path.join(root, 'clip.xyz'), Buffer.from('fake'));
      await expect(prepareAudioData('clip.xyz')).rejects.toThrow('Unsupported audio format');
    });
  });

  it('rejects private IPv4 URLs', async () => {
    await expect(prepareAudioData('http://127.0.0.1:8080/audio.wav')).rejects.toThrow();
    await expect(prepareAudioData('http://192.168.1.1/audio.mp3')).rejects.toThrow();
  });

  it('rejects localhost hostnames', async () => {
    await expect(assertUrlSafeForFetch('http://localhost/audio.wav')).rejects.toThrow();
  });
});

describe('isBlockedIPv4 (re-exported from fetch-utils)', () => {
  it('identifies loopback and RFC1918', () => {
    expect(isBlockedIPv4('127.0.0.1')).toBe(true);
    expect(isBlockedIPv4('10.0.0.1')).toBe(true);
    expect(isBlockedIPv4('192.168.1.1')).toBe(true);
    expect(isBlockedIPv4('172.16.0.1')).toBe(true);
    expect(isBlockedIPv4('8.8.8.8')).toBe(false);
  });

  it('blocks metadata endpoint IP', () => {
    expect(isBlockedIPv4('169.254.169.254')).toBe(true);
  });
});
