import { describe, it, expect } from 'vitest';
import { getMimeType, fetchImage, optimizeImage, prepareImageUrl } from '../tool-handlers/image-utils.js';
import path from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';

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

describe('fetchImage', () => {
  it('should decode base64 data URLs', async () => {
    const data = Buffer.from('hello').toString('base64');
    const buf = await fetchImage(`data:image/png;base64,${data}`);
    expect(buf.toString()).toBe('hello');
  });

  it('should reject invalid data URLs', async () => {
    await expect(fetchImage('data:invalid')).rejects.toThrow('Invalid data URL');
  });

  it('should read local files', async () => {
    const tmpFile = path.join(tmpdir(), `test-img-${Date.now()}.txt`);
    writeFileSync(tmpFile, 'test-content');
    const buf = await fetchImage(tmpFile);
    expect(buf.toString()).toBe('test-content');
  });

  it('should throw on missing files', async () => {
    await expect(fetchImage('/nonexistent/path/image.png')).rejects.toThrow();
  });
});

describe('optimizeImage', () => {
  it('should return base64 string for any buffer', async () => {
    // Even without sharp, fallback should return base64
    const buf = Buffer.from('fake-image-data');
    const result = await optimizeImage(buf);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('prepareImageUrl', () => {
  it('should pass through data URLs unchanged', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const result = await prepareImageUrl(dataUrl);
    expect(result).toBe(dataUrl);
  });

  it('should convert local files to data URLs', async () => {
    // Create a tiny valid file
    const tmpFile = path.join(tmpdir(), `test-prep-${Date.now()}.png`);
    writeFileSync(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic bytes
    const result = await prepareImageUrl(tmpFile);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });
});
