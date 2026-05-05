import path from 'path';
import { promises as fs } from 'fs';
import {
  readEnvInt,
  isBlockedIPv4 as _isBlockedIPv4,
  assertUrlSafeForFetch as _assertUrlSafeForFetch,
  fetchHttpResource,
  parseBase64DataUrl,
} from './fetch-utils.js';

// Re-export for backward compatibility (tests import from image-utils)
export const isBlockedIPv4 = _isBlockedIPv4;
export const assertUrlSafeForFetch = _assertUrlSafeForFetch;

const DEFAULT_MAX_DIMENSION = 800;
const DEFAULT_JPEG_QUALITY = 80;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 8;
const DEFAULT_MAX_DATA_URL_BYTES = 20 * 1024 * 1024;

export function getMaxImageDimension(): number {
  return readEnvInt('OPENROUTER_IMAGE_MAX_DIMENSION', DEFAULT_MAX_DIMENSION, 64);
}

export function getImageJpegQuality(): number {
  return readEnvInt('OPENROUTER_IMAGE_JPEG_QUALITY', DEFAULT_JPEG_QUALITY, 1);
}

function getFetchTimeoutMs(): number {
  return readEnvInt('OPENROUTER_IMAGE_FETCH_TIMEOUT_MS', DEFAULT_FETCH_TIMEOUT_MS, 1000);
}

function getMaxDownloadBytes(): number {
  return readEnvInt('OPENROUTER_IMAGE_MAX_DOWNLOAD_BYTES', DEFAULT_MAX_DOWNLOAD_BYTES, 1024);
}

function getMaxRedirects(): number {
  return readEnvInt('OPENROUTER_IMAGE_MAX_REDIRECTS', DEFAULT_MAX_REDIRECTS, 0);
}

function getMaxDataUrlBytes(): number {
  return readEnvInt('OPENROUTER_IMAGE_MAX_DATA_URL_BYTES', DEFAULT_MAX_DATA_URL_BYTES, 1024);
}

let sharpFn: ((input: Buffer) => import('sharp').Sharp) | null = null;
let loaded = false;

async function loadSharp(): Promise<((input: Buffer) => import('sharp').Sharp) | null> {
  if (!loaded) {
    loaded = true;
    try {
      const mod = await import('sharp');
      const fn = (mod as unknown as { default?: (input: Buffer) => import('sharp').Sharp }).default;
      sharpFn = fn ?? (mod as unknown as (input: Buffer) => import('sharp').Sharp);
    } catch {
      // sharp is optional — images will be sent unprocessed (larger but functional)
      const { logger } = await import('../logger.js');
      logger.warn('sharp not available, images will be sent unprocessed');
    }
  }
  return sharpFn;
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
  };
  return map[ext] || 'image/jpeg';
}

export async function fetchHttpImage(urlString: string): Promise<Buffer> {
  const { buffer } = await fetchHttpResource(urlString, {
    timeoutMs: getFetchTimeoutMs(),
    maxBytes: getMaxDownloadBytes(),
    maxRedirects: getMaxRedirects(),
  });
  return buffer;
}

export async function fetchImage(source: string): Promise<Buffer> {
  if (source.startsWith('data:')) {
    const parsed = parseBase64DataUrl(source);
    if (!parsed) throw new Error('Invalid data URL');
    const approxBytes = Math.ceil((parsed.base64.length * 3) / 4);
    if (approxBytes > getMaxDataUrlBytes()) throw new Error('Data URL too large');
    return Buffer.from(parsed.base64, 'base64');
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    return fetchHttpImage(source);
  }

  return fs.readFile(source);
}

/**
 * Sniff image MIME type from magic bytes. Used to label the output of a
 * failed `sharp` optimization (where we return original bytes but don't
 * know the source MIME yet) and HTTP image responses whose Content-Type
 * header is missing or wrong.
 */
export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image/gif';
  }
  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  // BMP
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
  return null;
}

/**
 * Optimize an image buffer and return both the base64 payload AND the MIME
 * type that matches that payload. Callers should NOT assume JPEG — the
 * pipeline falls back to the original bytes (with its detected MIME) when
 * sharp is unavailable or fails. This closes BUG-012.
 */
export async function optimizeImage(buffer: Buffer): Promise<{ base64: string; mime: string }> {
  const sharp = await loadSharp();
  if (!sharp) {
    return {
      base64: buffer.toString('base64'),
      mime: sniffImageMime(buffer) ?? 'application/octet-stream',
    };
  }

  const maxDim = getMaxImageDimension();
  const quality = getImageJpegQuality();

  try {
    const meta = await sharp(buffer).metadata();
    let pipeline = sharp(buffer);

    if (meta.width && meta.height && Math.max(meta.width, meta.height) > maxDim) {
      const opts = meta.width > meta.height ? { width: maxDim } : { height: maxDim };
      pipeline = pipeline.resize(opts);
    }

    const out = await pipeline.jpeg({ quality }).toBuffer();
    return { base64: out.toString('base64'), mime: 'image/jpeg' };
  } catch {
    return {
      base64: buffer.toString('base64'),
      mime: sniffImageMime(buffer) ?? 'application/octet-stream',
    };
  }
}

export async function prepareImageUrl(source: string): Promise<string> {
  if (source.startsWith('data:')) return source;

  const buffer = await fetchImage(source);
  const { base64, mime } = await optimizeImage(buffer);
  // When optimization succeeded, mime is 'image/jpeg'. When it failed, we
  // use the sniffed mime. For local files we prefer the extension-derived
  // mime (more specific) when optimization fell back.
  const finalMime =
    mime === 'image/jpeg' || source.startsWith('http') ? mime : getMimeType(source);
  return `data:${finalMime};base64,${base64}`;
}
