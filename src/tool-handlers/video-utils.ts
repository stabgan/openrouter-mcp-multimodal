/**
 * Video format detection and fetch utilities. Mirrors the structure of
 * `audio-utils.ts`: all network/security logic comes from `fetch-utils.ts`,
 * this module owns format detection, base64 encoding, and MIME mapping.
 *
 * OpenRouter's video-understanding docs (accessed 2026-04-20) list four
 * supported container formats: mp4, mpeg, mov, webm.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { readEnvInt, fetchHttpResource, parseBase64DataUrl } from './fetch-utils.js';
import { resolveSafeInputPath } from './path-safety.js';

export { isBlockedIPv4, assertUrlSafeForFetch } from './fetch-utils.js';

const DEFAULT_FETCH_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const DEFAULT_MAX_REDIRECTS = 8;
const DEFAULT_MAX_DATA_URL_BYTES = 100 * 1024 * 1024;

function getFetchTimeoutMs(): number {
  return readEnvInt('OPENROUTER_VIDEO_FETCH_TIMEOUT_MS', DEFAULT_FETCH_TIMEOUT_MS, 1000);
}
function getMaxDownloadBytes(): number {
  return readEnvInt('OPENROUTER_VIDEO_MAX_DOWNLOAD_BYTES', DEFAULT_MAX_DOWNLOAD_BYTES, 1024);
}
function getMaxRedirects(): number {
  return readEnvInt('OPENROUTER_VIDEO_MAX_REDIRECTS', DEFAULT_MAX_REDIRECTS, 0);
}
function getMaxDataUrlBytes(): number {
  return readEnvInt('OPENROUTER_VIDEO_MAX_DATA_URL_BYTES', DEFAULT_MAX_DATA_URL_BYTES, 1024);
}

export const SUPPORTED_VIDEO_FORMATS = ['mp4', 'mpeg', 'mov', 'webm'] as const;
export type VideoFormat = (typeof SUPPORTED_VIDEO_FORMATS)[number];

/** Map a file extension (without the dot) to a canonical VideoFormat. */
export function getVideoFormat(filePath: string): VideoFormat | undefined {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const alias: Record<string, VideoFormat> = {
    mp4: 'mp4',
    m4v: 'mp4',
    mpeg: 'mpeg',
    mpg: 'mpeg',
    mov: 'mov',
    qt: 'mov',
    webm: 'webm',
  };
  return alias[ext];
}

/** Canonical MIME type for each format. */
export function getVideoMimeType(format: VideoFormat): string {
  const map: Record<VideoFormat, string> = {
    mp4: 'video/mp4',
    mpeg: 'video/mpeg',
    mov: 'video/mov',
    webm: 'video/webm',
  };
  return map[format];
}

function mimeSubtypeToFormat(subtype: string): VideoFormat | undefined {
  const aliasMap: Record<string, VideoFormat> = {
    mp4: 'mp4',
    'x-m4v': 'mp4',
    mpeg: 'mpeg',
    mov: 'mov',
    quicktime: 'mov',
    'x-quicktime': 'mov',
    webm: 'webm',
  };
  const lower = subtype.toLowerCase();
  return aliasMap[lower];
}

function formatFromContentType(ct: string | null): VideoFormat | undefined {
  if (!ct) return undefined;
  const mime = ct.split(';')[0]!.trim().toLowerCase();
  if (!mime.startsWith('video/')) return undefined;
  return mimeSubtypeToFormat(mime.slice(6));
}

/**
 * Detect a container from the first bytes of a buffer. Recognizes mp4/mov
 * (`ftyp` box at offset 4), webm (EBML magic `1A 45 DF A3`), and MPEG-PS
 * (`00 00 01 BA` / `00 00 01 B3`). Returns `undefined` if no match.
 *
 * Intentionally conservative: if the magic doesn't match, the caller falls
 * back to the filename / Content-Type.
 */
export function detectVideoFormat(buffer: Buffer): VideoFormat | undefined {
  if (buffer.length >= 12) {
    const box = buffer.subarray(4, 8).toString('ascii');
    if (box === 'ftyp') {
      // Brand tells mp4 vs mov. 'qt  ' and 'mov ' indicate QuickTime.
      const brand = buffer.subarray(8, 12).toString('ascii');
      if (brand === 'qt  ' || brand === 'mov ') return 'mov';
      return 'mp4';
    }
  }
  if (buffer.length >= 4) {
    // EBML header — WebM & Matroska.
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
      return 'webm';
    }
    // MPEG-PS / MPEG-TS start codes.
    if (
      buffer[0] === 0x00 &&
      buffer[1] === 0x00 &&
      buffer[2] === 0x01 &&
      (buffer[3] === 0xba || buffer[3] === 0xb3 || buffer[3] === 0xe0)
    ) {
      return 'mpeg';
    }
  }
  return undefined;
}

export interface VideoData {
  data: string; // base64
  format: VideoFormat;
  mediaType: string; // e.g. 'video/mp4'
  sizeBytes: number; // raw bytes before base64
}

/**
 * Prepare a video from any source (data URL / HTTP URL / local file) as
 * base64 + MIME. OpenRouter requires the client to send video as either a
 * URL or a data URL; we always base64 it so the tool works regardless of
 * provider quirks.
 */
export async function prepareVideoData(source: string): Promise<VideoData> {
  // --- data URL ---
  if (source.startsWith('data:')) {
    const parsed = parseBase64DataUrl(source);
    if (!parsed) throw new Error('Invalid video data URL');
    if (!parsed.mediaType.startsWith('video/')) {
      throw new Error(`Data URL is not a video/* MIME: ${parsed.mediaType}`);
    }
    const format = mimeSubtypeToFormat(parsed.mediaType.slice(6));
    if (!format) {
      throw new Error(
        `Unsupported video format from MIME: ${parsed.mediaType}. Supported: ${SUPPORTED_VIDEO_FORMATS.join(', ')}`,
      );
    }
    const approxBytes = Math.ceil((parsed.base64.length * 3) / 4);
    if (approxBytes > getMaxDataUrlBytes()) throw new Error('Video data URL too large');
    return {
      data: parsed.base64,
      format,
      mediaType: getVideoMimeType(format),
      sizeBytes: approxBytes,
    };
  }

  // --- HTTP(S) URL ---
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const { buffer, contentType } = await fetchHttpResource(source, {
      timeoutMs: getFetchTimeoutMs(),
      maxBytes: getMaxDownloadBytes(),
      maxRedirects: getMaxRedirects(),
    });
    const urlPath = new URL(source).pathname;
    const format =
      detectVideoFormat(buffer) ?? getVideoFormat(urlPath) ?? formatFromContentType(contentType);
    if (!format) {
      throw new Error(
        `Could not determine video format from ${source}. Supported: ${SUPPORTED_VIDEO_FORMATS.join(', ')}`,
      );
    }
    return {
      data: buffer.toString('base64'),
      format,
      mediaType: getVideoMimeType(format),
      sizeBytes: buffer.length,
    };
  }

  // --- local file ---
  const safe = await resolveSafeInputPath(source);
  const buffer = await fs.readFile(safe);
  const format = detectVideoFormat(buffer) ?? getVideoFormat(safe);
  if (!format) {
    throw new Error(
      `Unsupported video format for file: ${source}. Supported: ${SUPPORTED_VIDEO_FORMATS.join(', ')}`,
    );
  }
  return {
    data: buffer.toString('base64'),
    format,
    mediaType: getVideoMimeType(format),
    sizeBytes: buffer.length,
  };
}
