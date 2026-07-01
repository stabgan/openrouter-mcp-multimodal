/**
 * Audio format detection, base64 encoding, and fetch utilities.
 * Network/security logic is delegated to fetch-utils.ts (zero duplication).
 */
import path from 'path';
import { promises as fs } from 'fs';
import { readEnvInt, fetchHttpResource, parseBase64DataUrl } from './fetch-utils.js';
import { resolveSafeInputPath } from './path-safety.js';

// Re-export for tests
export { isBlockedIPv4, assertUrlSafeForFetch } from './fetch-utils.js';

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 8;
const DEFAULT_MAX_DATA_URL_BYTES = 20 * 1024 * 1024;

function getFetchTimeoutMs(): number {
  return readEnvInt('OPENROUTER_AUDIO_FETCH_TIMEOUT_MS', DEFAULT_FETCH_TIMEOUT_MS, 1000);
}
function getMaxDownloadBytes(): number {
  return readEnvInt('OPENROUTER_AUDIO_MAX_DOWNLOAD_BYTES', DEFAULT_MAX_DOWNLOAD_BYTES, 1024);
}
function getMaxRedirects(): number {
  return readEnvInt('OPENROUTER_AUDIO_MAX_REDIRECTS', DEFAULT_MAX_REDIRECTS, 0);
}
function getMaxDataUrlBytes(): number {
  return readEnvInt('OPENROUTER_AUDIO_MAX_DATA_URL_BYTES', DEFAULT_MAX_DATA_URL_BYTES, 1024);
}

/** File-extension formats (matchable by .ext) */
const FILE_AUDIO_FORMATS = ['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac', 'm4a'] as const;
/** API-only formats (no real file extension) */
const API_AUDIO_FORMATS = ['pcm16', 'pcm24'] as const;

export const SUPPORTED_AUDIO_FORMATS = [...FILE_AUDIO_FORMATS, ...API_AUDIO_FORMATS] as const;
export type AudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number];
type FileAudioFormat = (typeof FILE_AUDIO_FORMATS)[number];

/** Get audio format from file extension. Returns undefined for non-audio or API-only formats. */
export function getAudioFormat(filePath: string): FileAudioFormat | undefined {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return (FILE_AUDIO_FORMATS as readonly string[]).includes(ext)
    ? (ext as FileAudioFormat)
    : undefined;
}

/** Get MIME type for an audio format. */
export function getAudioMimeType(format: AudioFormat): string {
  const map: Record<AudioFormat, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    aiff: 'audio/aiff',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    pcm16: 'audio/pcm',
    pcm24: 'audio/pcm',
  };
  return map[format] || 'audio/wav';
}

/** Map a MIME subtype (e.g. "mpeg", "wave") to an AudioFormat. */
function mimeSubtypeToFormat(subtype: string): AudioFormat | undefined {
  const aliasMap: Record<string, AudioFormat> = {
    mpeg: 'mp3',
    wav: 'wav',
    wave: 'wav',
    mp3: 'mp3',
    flac: 'flac',
    ogg: 'ogg',
    aac: 'aac',
    'x-aac': 'aac',
    m4a: 'm4a',
    mp4: 'm4a',
    aiff: 'aiff',
    'x-aiff': 'aiff',
    pcm: 'pcm16',
  };
  const lower = subtype.toLowerCase();
  return (
    aliasMap[lower] ??
    ((SUPPORTED_AUDIO_FORMATS as readonly string[]).includes(lower)
      ? (lower as AudioFormat)
      : undefined)
  );
}

/** Derive AudioFormat from a Content-Type header value. */
function formatFromContentType(ct: string | null): AudioFormat | undefined {
  if (!ct) return undefined;
  const mime = ct.split(';')[0]!.trim().toLowerCase();
  if (!mime.startsWith('audio/')) return undefined;
  return mimeSubtypeToFormat(mime.slice(6));
}

export interface AudioData {
  data: string; // base64-encoded
  format: AudioFormat;
}

/**
 * Prepare audio from any source (data URL, HTTP URL, local file) as base64 + format.
 * OpenRouter requires audio to be base64-encoded; direct URLs are NOT supported.
 */
export async function prepareAudioData(source: string): Promise<AudioData> {
  // --- data URL ---
  if (source.startsWith('data:')) {
    const parsed = parseBase64DataUrl(source);
    if (!parsed) throw new Error('Invalid data URL format');

    const format = mimeSubtypeToFormat(parsed.mediaType.split('/')[1] ?? '');
    if (!format) {
      throw new Error(
        `Unsupported audio format from MIME: ${parsed.mediaType}. Supported: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
      );
    }
    const approxBytes = Math.ceil((parsed.base64.length * 3) / 4);
    if (approxBytes > getMaxDataUrlBytes()) throw new Error('Data URL too large');
    return { data: parsed.base64, format };
  }

  // --- HTTP(S) URL ---
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const { buffer, contentType } = await fetchHttpResource(source, {
      timeoutMs: getFetchTimeoutMs(),
      maxBytes: getMaxDownloadBytes(),
      maxRedirects: getMaxRedirects(),
    });
    // Try URL path extension first, fall back to Content-Type header
    const urlPath = new URL(source).pathname;
    const format = getAudioFormat(urlPath) ?? formatFromContentType(contentType);
    if (!format) {
      throw new Error(
        `Could not determine audio format from URL: ${source}. Supported: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
      );
    }
    return { data: buffer.toString('base64'), format };
  }

  // --- local file ---
  const safe = await resolveSafeInputPath(source);
  const format = getAudioFormat(safe);
  if (!format) {
    throw new Error(
      `Unsupported audio format for file: ${source}. Supported: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
    );
  }
  const buffer = await fs.readFile(safe);
  return { data: buffer.toString('base64'), format };
}
