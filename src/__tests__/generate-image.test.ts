import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { resolveInputImage, buildUserContent } from '../tool-handlers/generate-image-input.js';
import { UnsafeOutputPathError } from '../tool-handlers/path-safety.js';
import { withInputSandbox } from './helpers/input-sandbox.js';

describe('resolveInputImage', () => {
  it('passes data: URLs through unchanged', async () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(await resolveInputImage(url)).toBe(url);
  });

  it('passes http(s) URLs through unchanged', async () => {
    expect(await resolveInputImage('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(await resolveInputImage('http://example.com/a.jpg')).toBe('http://example.com/a.jpg');
  });

  it('reads a relative file under the root and inlines as base64 data URL', async () => {
    await withInputSandbox('mcp-input-image-', async (root) => {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await fs.writeFile(path.join(root, 'ref.png'), bytes);

      const url = await resolveInputImage('ref.png');
      expect(url).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
    });
  });

  it('detects mime from extension (.jpeg → image/jpeg)', async () => {
    await withInputSandbox('mcp-input-image-', async (root) => {
      const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      await fs.writeFile(path.join(root, 'photo.jpeg'), bytes);

      const url = await resolveInputImage('photo.jpeg');
      expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    });
  });

  it('falls back to image/png for unknown extensions', async () => {
    await withInputSandbox('mcp-input-image-', async (root) => {
      await fs.writeFile(path.join(root, 'mystery.bin'), Buffer.from([0x00]));
      const url = await resolveInputImage('mystery.bin');
      expect(url.startsWith('data:image/png;base64,')).toBe(true);
    });
  });

  it('accepts absolute paths that land inside the root', async () => {
    await withInputSandbox('mcp-input-image-', async (root) => {
      const bytes = Buffer.from([1, 2, 3]);
      const abs = path.join(root, 'inside.webp');
      await fs.writeFile(abs, bytes);

      const url = await resolveInputImage(abs);
      expect(url).toBe(`data:image/webp;base64,${bytes.toString('base64')}`);
    });
  });

  it('propagates sandbox traversal errors from resolveSafeInputPath', async () => {
    await withInputSandbox('mcp-input-image-', async () => {
      await expect(resolveInputImage('../escape.png')).rejects.toBeInstanceOf(
        UnsafeOutputPathError,
      );
    });
  });

  it('rejects empty entries', async () => {
    await expect(resolveInputImage('')).rejects.toThrow(/empty/);
    await expect(resolveInputImage('   ')).rejects.toThrow(/empty/);
  });
});

describe('buildUserContent', () => {
  it.each([undefined, []] as const)(
    'returns a plain string when input_images is %s',
    async (inputImages) => {
      const out = await buildUserContent('a sunset', inputImages);
      expect(out).toBe('Generate an image: a sunset');
    },
  );

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

  it('preserves the order of input_images including local files', async () => {
    await withInputSandbox('mcp-build-content-', async (root) => {
      await fs.writeFile(path.join(root, 'a.png'), Buffer.from([0x01]));
      await fs.writeFile(path.join(root, 'b.png'), Buffer.from([0x02]));

      const out = await buildUserContent('scene', [
        'https://example.com/a.png',
        'a.png',
        'data:image/png;base64,CCC=',
        'b.png',
      ]);

      const urls = (out as Array<Record<string, unknown>>)
        .filter((p) => p.type === 'image_url')
        .map((p) => (p.image_url as { url: string }).url);
      expect(urls[0]).toBe('https://example.com/a.png');
      expect(urls[1]).toContain('base64,');
      expect(urls[2]).toBe('data:image/png;base64,CCC=');
      expect(urls[3]).toContain('base64,');
    });
  });

  it('rejects empty input_images entries', async () => {
    await expect(buildUserContent('scene', ['https://example.com/a.png', '   '])).rejects.toThrow(
      /empty/,
    );
  });
});
