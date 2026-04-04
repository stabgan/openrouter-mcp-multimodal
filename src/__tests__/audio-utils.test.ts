import { describe, it, expect } from 'vitest';
import {
  getAudioFormat,
  getAudioMimeType,
  prepareAudioData,
  isBlockedIPv4,
  assertUrlSafeForFetch,
  SUPPORTED_AUDIO_FORMATS,
} from '../tool-handlers/audio-utils.js';
import path from 'path';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';

describe('getAudioFormat', () => {
  it('should return correct format for supported extensions', () => {
    expect(getAudioFormat('audio.wav')).toBe('wav');
    expect(getAudioFormat('audio.mp3')).toBe('mp3');
    expect(getAudioFormat('audio.flac')).toBe('flac');
    expect(getAudioFormat('audio.ogg')).toBe('ogg');
    expect(getAudioFormat('audio.aac')).toBe('aac');
    expect(getAudioFormat('audio.m4a')).toBe('m4a');
    expect(getAudioFormat('audio.aiff')).toBe('aiff');
  });

  it('should return undefined for unsupported extensions', () => {
    expect(getAudioFormat('audio.xyz')).toBeUndefined();
    expect(getAudioFormat('audio.mid')).toBeUndefined();
    expect(getAudioFormat('noext')).toBeUndefined();
  });

  it('should handle uppercase extensions', () => {
    expect(getAudioFormat('audio.WAV')).toBe('wav');
    expect(getAudioFormat('audio.MP3')).toBe('mp3');
  });
});

describe('getAudioMimeType', () => {
  it('should return correct MIME types', () => {
    expect(getAudioMimeType('wav')).toBe('audio/wav');
    expect(getAudioMimeType('mp3')).toBe('audio/mpeg');
    expect(getAudioMimeType('flac')).toBe('audio/flac');
    expect(getAudioMimeType('ogg')).toBe('audio/ogg');
    expect(getAudioMimeType('aac')).toBe('audio/aac');
    expect(getAudioMimeType('m4a')).toBe('audio/mp4');
    expect(getAudioMimeType('aiff')).toBe('audio/aiff');
  });
});

describe('SUPPORTED_AUDIO_FORMATS', () => {
  it('should include common audio formats', () => {
    expect(SUPPORTED_AUDIO_FORMATS).toContain('wav');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('mp3');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('flac');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('ogg');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('aac');
    expect(SUPPORTED_AUDIO_FORMATS).toContain('m4a');
  });
});

describe('prepareAudioData', () => {
  it('should decode base64 data URLs with correct format', async () => {
    const audioData = Buffer.from('fake-audio-data').toString('base64');
    const result = await prepareAudioData(`data:audio/wav;base64,${audioData}`);
    expect(result.data).toBe(audioData);
    expect(result.format).toBe('wav');
  });

  it('should decode mp3 data URLs (audio/mpeg MIME)', async () => {
    const audioData = Buffer.from('fake-audio-data').toString('base64');
    const result = await prepareAudioData(`data:audio/mpeg;base64,${audioData}`);
    expect(result.data).toBe(audioData);
    expect(result.format).toBe('mp3'); // mpeg MIME maps to mp3 format
  });

  it('should reject invalid data URLs', async () => {
    await expect(prepareAudioData('data:invalid')).rejects.toThrow('Invalid data URL');
  });

  it('should reject unsupported MIME types', async () => {
    const audioData = Buffer.from('fake-audio-data').toString('base64');
    await expect(prepareAudioData(`data:audio/xyz;base64,${audioData}`)).rejects.toThrow(
      'Unsupported audio format',
    );
  });

  it('should read local files and return base64 with format', async () => {
    const tmpFile = path.join(tmpdir(), `test-audio-${Date.now()}.wav`);
    writeFileSync(tmpFile, Buffer.from('fake-audio-content'));
    const result = await prepareAudioData(tmpFile);
    expect(result.data).toBe(Buffer.from('fake-audio-content').toString('base64'));
    expect(result.format).toBe('wav');
  });

  it('should throw on missing files', async () => {
    await expect(prepareAudioData('/nonexistent/path/audio.wav')).rejects.toThrow();
  });

  it('should throw on unsupported file extensions', async () => {
    const tmpFile = path.join(tmpdir(), `test-audio-${Date.now()}.xyz`);
    writeFileSync(tmpFile, Buffer.from('fake-audio-content'));
    await expect(prepareAudioData(tmpFile)).rejects.toThrow('Unsupported audio format');
  });

  it('should reject private IPv4 URLs', async () => {
    await expect(prepareAudioData('http://127.0.0.1:8080/audio.wav')).rejects.toThrow();
    await expect(prepareAudioData('http://192.168.1.1/audio.mp3')).rejects.toThrow();
  });

  it('should reject localhost hostnames', async () => {
    await expect(assertUrlSafeForFetch('http://localhost/audio.wav')).rejects.toThrow();
  });
});

describe('isBlockedIPv4', () => {
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
