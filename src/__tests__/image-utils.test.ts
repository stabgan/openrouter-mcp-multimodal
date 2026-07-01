import { describe, it, expect } from 'vitest';
import {
  getMimeType,
  mimeFromExtension,
  fetchImage,
  optimizeImage,
  prepareImageUrl,
  isBlockedIPv4,
  assertUrlSafeForFetch,
} from '../tool-handlers/image-utils.js';
import { UnsafeOutputPathError } from '../tool-handlers/path-safety.js';
import { withInputSandbox } from './helpers/input-sandbox.js';
import path from 'path';
import { writeFileSync } from 'fs';

describe('getMimeType', () => {
  it('should return correct MIME types', () => {
    expect(getMimeType('photo.png')).toBe('image/png');
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(getMimeType('photo.webp')).toBe('image/webp');
    expect(getMimeType('photo.gif')).toBe('image/gif');
    expect(getMimeType('photo.bmp')).toBe('image/bmp');
  });

  it('should default to image/jpeg for unknown extensions', () => {
    expect(getMimeType('file.xyz')).toBe('image/jpeg');
    expect(getMimeType('noext')).toBe('image/jpeg');
  });
});

describe('mimeFromExtension', () => {
  it('maps known image extensions', () => {
    expect(mimeFromExtension('.png')).toBe('image/png');
    expect(mimeFromExtension('png')).toBe('image/png');
    expect(mimeFromExtension('.PNG')).toBe('image/png');
    expect(mimeFromExtension('.jpg')).toBe('image/jpeg');
    expect(mimeFromExtension('.jpeg')).toBe('image/jpeg');
    expect(mimeFromExtension('.webp')).toBe('image/webp');
    expect(mimeFromExtension('.gif')).toBe('image/gif');
    expect(mimeFromExtension('.bmp')).toBe('image/bmp');
  });

  it('returns null for unknown extensions', () => {
    expect(mimeFromExtension('.tiff')).toBeNull();
    expect(mimeFromExtension('')).toBeNull();
  });
});

describe('fetchImage', () => {
  it('should decode base64 data URLs', async () => {
    const data = Buffer.from('hello').toString('base64');
    const buf = await fetchImage(`data:image/png;base64,${data}`);
    expect(buf.toString()).toBe('hello');
  });

  it('should reject invalid data URLs', async () => {
    await expect(fetchImage('data:invalid')).rejects.toThrow('Invalid data URL');
  });

  it('should read local files inside the input sandbox', async () => {
    await withInputSandbox('mcp-fetch-img-', async (root) => {
      const rel = 'test-content.txt';
      writeFileSync(path.join(root, rel), 'test-content');
      const buf = await fetchImage(rel);
      expect(buf.toString()).toBe('test-content');
    });
  });

  it('should reject paths outside the input sandbox', async () => {
    await withInputSandbox('mcp-fetch-img-', async () => {
      await expect(fetchImage('/etc/passwd')).rejects.toBeInstanceOf(UnsafeOutputPathError);
      await expect(fetchImage('../escape.png')).rejects.toBeInstanceOf(UnsafeOutputPathError);
    });
  });

  it('should throw on missing files inside the sandbox', async () => {
    await withInputSandbox('mcp-fetch-img-', async () => {
      await expect(fetchImage('missing.png')).rejects.toThrow();
    });
  });

  it('should reject private IPv4 URLs', async () => {
    await expect(fetchImage('http://127.0.0.1:8080/x')).rejects.toThrow();
    await expect(fetchImage('http://192.168.1.1/x')).rejects.toThrow();
  });

  it('should reject localhost hostnames', async () => {
    await expect(assertUrlSafeForFetch('http://localhost/foo')).rejects.toThrow();
  });
});

describe('isBlockedIPv4', () => {
  it('identifies loopback and RFC1918', () => {
    expect(isBlockedIPv4('127.0.0.1')).toBe(true);
    expect(isBlockedIPv4('10.0.0.1')).toBe(true);
    expect(isBlockedIPv4('8.8.8.8')).toBe(false);
  });
});

describe('optimizeImage', () => {
  it('returns base64 + mime for any buffer', async () => {
    // Even without sharp, fallback should return base64 + a best-effort mime
    const buf = Buffer.from('fake-image-data');
    const result = await optimizeImage(buf);
    expect(typeof result.base64).toBe('string');
    expect(result.base64.length).toBeGreaterThan(0);
    expect(typeof result.mime).toBe('string');
  });
});

describe('prepareImageUrl', () => {
  it('should pass through data URLs unchanged', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const result = await prepareImageUrl(dataUrl);
    expect(result).toBe(dataUrl);
  });

  it('should convert local files to data URLs', async () => {
    await withInputSandbox('mcp-prep-img-', async (root) => {
      const rel = 'test-prep.png';
      writeFileSync(path.join(root, rel), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const result = await prepareImageUrl(rel);
      expect(result).toMatch(/^data:image\/png;base64,/);
    });
  });
});
