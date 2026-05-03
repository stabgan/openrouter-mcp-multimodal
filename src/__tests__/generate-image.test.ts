import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  resolveInputImage,
  buildUserContent,
  mimeFromExt,
} from '../tool-handlers/generate-image.js';
import { UnsafeOutputPathError } from '../tool-handlers/path-safety.js';

describe('mimeFromExt', () => {
  it('maps known image extensions', () => {
    expect(mimeFromExt('.png')).toBe('image/png');
    expect(mimeFromExt('png')).toBe('image/png');
    expect(mimeFromExt('.PNG')).toBe('image/png');
    expect(mimeFromExt('.jpg')).toBe('image/jpeg');
    expect(mimeFromExt('.jpeg')).toBe('image/jpeg');
    expect(mimeFromExt('.webp')).toBe('image/webp');
    expect(mimeFromExt('.gif')).toBe('image/gif');
  });

  it('returns null for unknown extensions', () => {
    expect(mimeFromExt('.tiff')).toBeNull();
    expect(mimeFromExt('')).toBeNull();
  });
});

describe('resolveInputImage', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'mcp-input-image-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', root);
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('passes data: URLs through unchanged', async () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(await resolveInputImage(url)).toBe(url);
  });

  it('passes http(s) URLs through unchanged', async () => {
    expect(await resolveInputImage('https://example.com/a.png')).toBe(
      'https://example.com/a.png',
    );
    expect(await resolveInputImage('http://example.com/a.jpg')).toBe(
      'http://example.com/a.jpg',
    );
  });

  it('reads a relative file under the root and inlines as base64 data URL', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await fs.writeFile(path.join(root, 'ref.png'), bytes);

    const url = await resolveInputImage('ref.png');
    expect(url).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
  });

  it('detects mime from extension (.jpeg → image/jpeg)', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    await fs.writeFile(path.join(root, 'photo.jpeg'), bytes);

    const url = await resolveInputImage('photo.jpeg');
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('falls back to image/png for unknown extensions', async () => {
    await fs.writeFile(path.join(root, 'mystery.bin'), Buffer.from([0x00]));
    const url = await resolveInputImage('mystery.bin');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('accepts absolute paths that land inside the root', async () => {
    const bytes = Buffer.from([1, 2, 3]);
    const abs = path.join(root, 'inside.webp');
    await fs.writeFile(abs, bytes);

    const url = await resolveInputImage(abs);
    expect(url).toBe(`data:image/webp;base64,${bytes.toString('base64')}`);
  });

  it('rejects traversal attempts that escape the root', async () => {
    await expect(resolveInputImage('../escape.png')).rejects.toBeInstanceOf(
      UnsafeOutputPathError,
    );
  });

  it('rejects absolute paths outside the root', async () => {
    await expect(resolveInputImage('/etc/passwd')).rejects.toBeInstanceOf(
      UnsafeOutputPathError,
    );
  });

  it('bypasses the sandbox when OPENROUTER_ALLOW_UNSAFE_PATHS=1', async () => {
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '1');

    const outside = path.join(tmpdir(), `mcp-unsafe-input-${Date.now()}.png`);
    const bytes = Buffer.from([42]);
    await fs.writeFile(outside, bytes);

    const url = await resolveInputImage(outside);
    expect(url).toBe(`data:image/png;base64,${bytes.toString('base64')}`);

    await fs.rm(outside, { force: true });
  });

  it('rejects empty entries', async () => {
    await expect(resolveInputImage('')).rejects.toThrow(/empty/);
    await expect(resolveInputImage('   ')).rejects.toThrow(/empty/);
  });

  it('falls back to OPENROUTER_OUTPUT_DIR when INPUT_DIR is unset', async () => {
    vi.stubEnv('OPENROUTER_INPUT_DIR', '');
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', root);

    const bytes = Buffer.from([0xab]);
    await fs.writeFile(path.join(root, 'fallback.gif'), bytes);

    const url = await resolveInputImage('fallback.gif');
    expect(url).toBe(`data:image/gif;base64,${bytes.toString('base64')}`);
  });
});

describe('buildUserContent', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'mcp-build-content-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', root);
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns a plain string when no input_images are provided', async () => {
    const out = await buildUserContent('a sunset', undefined);
    expect(out).toBe('Generate an image: a sunset');
  });

  it('returns a plain string for an empty input_images array', async () => {
    const out = await buildUserContent('a sunset', []);
    expect(out).toBe('Generate an image: a sunset');
  });

  it('builds multimodal content with text preamble and one image_url per ref', async () => {
    const out = await buildUserContent('khalid in the majlis', [
      'data:image/png;base64,AAA=',
      'https://example.com/lantern.png',
    ]);

    expect(Array.isArray(out)).toBe(true);
    const parts = out as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(3);

    expect(parts[0]).toMatchObject({ type: 'text' });
    expect(String((parts[0] as { text: string }).text)).toContain('khalid in the majlis');
    expect(String((parts[0] as { text: string }).text)).toContain('reference image');

    expect(parts[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAA=', detail: 'high' },
    });
    expect(parts[2]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'https://example.com/lantern.png', detail: 'high' },
    });
  });

  it('preserves the order of input_images', async () => {
    const out = await buildUserContent('scene', [
      'https://example.com/a.png',
      'https://example.com/b.png',
      'https://example.com/c.png',
    ]);

    const urls = (out as Array<Record<string, unknown>>)
      .filter((p) => p.type === 'image_url')
      .map((p) => (p.image_url as { url: string }).url);
    expect(urls).toEqual([
      'https://example.com/a.png',
      'https://example.com/b.png',
      'https://example.com/c.png',
    ]);
  });

  it('inlines local file refs as base64', async () => {
    const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    await fs.writeFile(path.join(root, 'face.png'), bytes);

    const out = await buildUserContent('scene', ['face.png']);
    const parts = out as Array<Record<string, unknown>>;
    expect((parts[1].image_url as { url: string }).url).toBe(
      `data:image/png;base64,${bytes.toString('base64')}`,
    );
  });
});
