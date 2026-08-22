import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  resolveImageUrl,
  resolveImageBase64,
  toOpenRouterImageReference,
} from '../tool-handlers/image-source.js';
import { fetchHttpResource } from '../tool-handlers/fetch-utils.js';

vi.mock('../tool-handlers/fetch-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tool-handlers/fetch-utils.js')>();
  return {
    ...actual,
    fetchHttpResource: vi.fn(),
  };
});

const mockedFetch = vi.mocked(fetchHttpResource);

describe('resolveImageUrl', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'mcp-image-url-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', root);
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
    mockedFetch.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects empty references', async () => {
    await expect(resolveImageUrl('')).rejects.toThrow('empty image reference');
    await expect(resolveImageUrl('   ')).rejects.toThrow('empty image reference');
  });

  it('passes through data URLs unchanged', async () => {
    const dataUrl = 'data:image/png;base64,abcd';
    await expect(resolveImageUrl(dataUrl)).resolves.toBe(dataUrl);
    await expect(resolveImageUrl(`  ${dataUrl}  `)).resolves.toBe(dataUrl);
  });

  it('passes through http(s) URLs unchanged', async () => {
    await expect(resolveImageUrl('https://example.com/a.png')).resolves.toBe(
      'https://example.com/a.png',
    );
    await expect(resolveImageUrl('http://example.com/a.png')).resolves.toBe(
      'http://example.com/a.png',
    );
  });

  it('reads a local file and returns a data URL', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await fs.writeFile(path.join(root, 'frame.png'), bytes);
    const url = await resolveImageUrl('frame.png');
    expect(url).toMatch(/^data:image\/png;base64,/);
    const b64 = url.split(',')[1]!;
    expect(Buffer.from(b64, 'base64')).toEqual(bytes);
  });

  it('defaults unknown extensions to image/jpeg', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff]);
    await fs.writeFile(path.join(root, 'photo.unknown'), bytes);
    const url = await resolveImageUrl('photo.unknown');
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('rejects path traversal for local files', async () => {
    await expect(resolveImageUrl('../escape.png')).rejects.toBeInstanceOf(Error);
  });
});

describe('resolveImageBase64', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'mcp-image-b64-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', root);
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
    mockedFetch.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects empty source', async () => {
    await expect(resolveImageBase64('')).rejects.toThrow('empty image source');
  });

  it('parses a valid data URL', async () => {
    const payload = 'aGVsbG8=';
    const result = await resolveImageBase64(`data:image/webp;base64,${payload}`);
    expect(result).toEqual({ mime: 'image/webp', data: payload });
  });

  it('parses data URLs with extra parameters', async () => {
    const payload = 'abcd';
    const result = await resolveImageBase64(`data:image/png;charset=utf-8;base64,${payload}`);
    expect(result).toEqual({ mime: 'image/png', data: payload });
  });

  it('rejects malformed data URLs', async () => {
    await expect(resolveImageBase64('data:not-base64,hello')).rejects.toThrow(/Invalid data URL/);
  });

  it('fetches http(s) URLs via fetchHttpResource', async () => {
    const buffer = Buffer.from('remote-image');
    mockedFetch.mockResolvedValue({
      buffer,
      contentType: 'image/png; charset=binary',
    });
    const result = await resolveImageBase64('https://cdn.example.com/x.png');
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://cdn.example.com/x.png',
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
    expect(result).toEqual({
      mime: 'image/png',
      data: buffer.toString('base64'),
    });
  });

  it('defaults http content type to image/jpeg when missing', async () => {
    mockedFetch.mockResolvedValue({
      buffer: Buffer.from('x'),
      contentType: undefined,
    });
    const result = await resolveImageBase64('https://example.com/no-ct');
    expect(result.mime).toBe('image/jpeg');
  });

  it('sniffs PNG magic bytes when content-type is missing', async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockedFetch.mockResolvedValue({
      buffer: pngBytes,
      contentType: undefined,
    });
    const result = await resolveImageBase64('https://example.com/raw.png');
    expect(result.mime).toBe('image/png');
    expect(Buffer.from(result.data, 'base64')).toEqual(pngBytes);
  });

  it('honors OPENROUTER_IMAGE_FETCH_TIMEOUT_MS for http fetches', async () => {
    vi.stubEnv('OPENROUTER_IMAGE_FETCH_TIMEOUT_MS', '12000');
    mockedFetch.mockResolvedValue({ buffer: Buffer.from('x'), contentType: 'image/jpeg' });
    await resolveImageBase64('https://example.com/timed.png');
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://example.com/timed.png',
      expect.objectContaining({ timeoutMs: 12_000 }),
    );
  });

  it('reads a local file into base64', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await fs.writeFile(path.join(root, 'local.png'), bytes);
    const result = await resolveImageBase64('local.png');
    expect(result.mime).toBe('image/png');
    expect(Buffer.from(result.data, 'base64')).toEqual(bytes);
  });
});

describe('toOpenRouterImageReference', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'mcp-image-ref-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', root);
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
    mockedFetch.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('wraps a data URL in OpenRouter image_url shape', async () => {
    const dataUrl = 'data:image/jpeg;base64,abc';
    await expect(toOpenRouterImageReference(dataUrl)).resolves.toEqual({
      type: 'image_url',
      image_url: { url: dataUrl },
    });
  });

  it('wraps a resolved local file data URL', async () => {
    await fs.writeFile(path.join(root, 'pic.jpg'), Buffer.from([0xff, 0xd8]));
    const ref = await toOpenRouterImageReference('pic.jpg');
    expect(ref.type).toBe('image_url');
    expect(ref.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });
});
