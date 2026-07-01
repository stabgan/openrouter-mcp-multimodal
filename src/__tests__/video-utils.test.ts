import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  getVideoFormat,
  getVideoMimeType,
  detectVideoFormat,
  prepareVideoData,
  SUPPORTED_VIDEO_FORMATS,
} from '../tool-handlers/video-utils.js';
import { UnsafeOutputPathError } from '../tool-handlers/path-safety.js';
import { withInputSandbox } from './helpers/input-sandbox.js';

describe('SUPPORTED_VIDEO_FORMATS', () => {
  it('matches OpenRouter docs (mp4, mpeg, mov, webm)', () => {
    expect([...SUPPORTED_VIDEO_FORMATS].sort()).toEqual(['mov', 'mp4', 'mpeg', 'webm']);
  });
});

describe('getVideoFormat', () => {
  it('returns correct format for common extensions', () => {
    expect(getVideoFormat('clip.mp4')).toBe('mp4');
    expect(getVideoFormat('clip.MP4')).toBe('mp4');
    expect(getVideoFormat('clip.m4v')).toBe('mp4');
    expect(getVideoFormat('clip.mpeg')).toBe('mpeg');
    expect(getVideoFormat('clip.mpg')).toBe('mpeg');
    expect(getVideoFormat('clip.mov')).toBe('mov');
    expect(getVideoFormat('clip.qt')).toBe('mov');
    expect(getVideoFormat('clip.webm')).toBe('webm');
  });

  it('returns undefined for unsupported extensions', () => {
    expect(getVideoFormat('clip.avi')).toBeUndefined();
    expect(getVideoFormat('clip.mkv')).toBeUndefined();
    expect(getVideoFormat('noext')).toBeUndefined();
  });
});

describe('getVideoMimeType', () => {
  it('maps formats to canonical MIME', () => {
    expect(getVideoMimeType('mp4')).toBe('video/mp4');
    expect(getVideoMimeType('mpeg')).toBe('video/mpeg');
    expect(getVideoMimeType('mov')).toBe('video/mov');
    expect(getVideoMimeType('webm')).toBe('video/webm');
  });
});

describe('detectVideoFormat', () => {
  it('detects mp4 via ftyp box', () => {
    // 0..3 = size, 4..7 = 'ftyp', 8..11 = 'isom' (mp4 brand)
    const buf = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('isom', 'ascii'),
    ]);
    expect(detectVideoFormat(buf)).toBe('mp4');
  });

  it('detects QuickTime via ftyp brand', () => {
    const buf = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x14]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('qt  ', 'ascii'),
    ]);
    expect(detectVideoFormat(buf)).toBe('mov');
  });

  it('detects WebM via EBML header', () => {
    const buf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00]);
    expect(detectVideoFormat(buf)).toBe('webm');
  });

  it('detects MPEG-PS start codes', () => {
    expect(detectVideoFormat(Buffer.from([0x00, 0x00, 0x01, 0xba]))).toBe('mpeg');
    expect(detectVideoFormat(Buffer.from([0x00, 0x00, 0x01, 0xb3]))).toBe('mpeg');
  });

  it('returns undefined for unknown bytes', () => {
    expect(detectVideoFormat(Buffer.from([0x12, 0x34, 0x56]))).toBeUndefined();
    expect(detectVideoFormat(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('prepareVideoData', () => {
  it('parses base64 data URL with mp4 MIME', async () => {
    const payload = Buffer.from('pretend-video-bytes').toString('base64');
    const r = await prepareVideoData(`data:video/mp4;base64,${payload}`);
    expect(r.data).toBe(payload);
    expect(r.format).toBe('mp4');
    expect(r.mediaType).toBe('video/mp4');
  });

  it('accepts MIME parameters in data URLs', async () => {
    const payload = Buffer.from('x').toString('base64');
    const r = await prepareVideoData(`data:video/webm;codecs=vp9;base64,${payload}`);
    expect(r.format).toBe('webm');
  });

  it('rejects non-video data URLs', async () => {
    const payload = Buffer.from('x').toString('base64');
    await expect(prepareVideoData(`data:image/png;base64,${payload}`)).rejects.toThrow('video/*');
  });

  it('rejects unsupported video MIME subtypes', async () => {
    const payload = Buffer.from('x').toString('base64');
    await expect(prepareVideoData(`data:video/avi;base64,${payload}`)).rejects.toThrow(
      'Unsupported video format',
    );
  });

  it('reads a local file and detects mp4 from magic bytes', async () => {
    await withInputSandbox('mcp-vid-', async (root) => {
      const contents = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x20]),
        Buffer.from('ftyp', 'ascii'),
        Buffer.from('isom', 'ascii'),
        Buffer.from('extra-bytes', 'ascii'),
      ]);
      writeFileSync(path.join(root, 'clip.mp4'), contents);
      const r = await prepareVideoData('clip.mp4');
      expect(r.format).toBe('mp4');
      expect(r.sizeBytes).toBe(contents.length);
    });
  });

  it('rejects private URLs via SSRF guard', async () => {
    await expect(prepareVideoData('http://127.0.0.1/clip.mp4')).rejects.toThrow();
    await expect(prepareVideoData('http://169.254.169.254/latest/metadata')).rejects.toThrow();
  });

  it('rejects unsupported local-file extensions with no detectable magic', async () => {
    await withInputSandbox('mcp-vid-', async (root) => {
      writeFileSync(path.join(root, 'clip.avi'), Buffer.from('unknown-bytes'));
      await expect(prepareVideoData('clip.avi')).rejects.toThrow('Unsupported video format');
    });
  });

  it('rejects paths outside the sandbox', async () => {
    await withInputSandbox('mcp-vid-', async () => {
      await expect(prepareVideoData('/etc/passwd')).rejects.toBeInstanceOf(UnsafeOutputPathError);
    });
  });
});
