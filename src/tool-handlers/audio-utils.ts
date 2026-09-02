/** Audio format detection and fetch utilities. */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { readEnvInt, fetchHttpResource, parseBase64DataUrl } from './fetch-utils.js';
import { resolveSafeInputPath } from './path-safety.js';

export { isBlockedIPv4, assertUrlSafeForFetch } from './fetch-utils.js';

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 8;

function getFetchTimeoutMs(): number {
  return readEnvInt('OPENROUTER_AUDIO_FETCH_TIMEOUT_MS', DEFAULT_FETCH_TIMEOUT_MS, 1000);
}

/** Shared ceiling for speech_to_text local, HTTP, and data-URL inputs. */
export function getMaxAudioInputBytes(): number {
  return readEnvInt('OPENROUTER_AUDIO_MAX_DOWNLOAD_BYTES', DEFAULT_MAX_DOWNLOAD_BYTES, 1);
}

function getMaxRedirects(): number {
  return readEnvInt('OPENROUTER_AUDIO_MAX_REDIRECTS', DEFAULT_MAX_REDIRECTS, 0);
}

const FILE_AUDIO_FORMATS = ['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac', 'm4a'] as const;
const API_AUDIO_FORMATS = ['pcm16', 'pcm24'] as const;

export const SUPPORTED_AUDIO_FORMATS = [...FILE_AUDIO_FORMATS, ...API_AUDIO_FORMATS] as const;
export type AudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number];
type FileAudioFormat = (typeof FILE_AUDIO_FORMATS)[number];

export const STT_FILE_EXTENSIONS = [
  'mp3',
  'mp4',
  'm4a',
  'wav',
  'flac',
  'ogg',
  'oga',
  'webm',
  'opus',
] as const;

export type SttFileExtension = (typeof STT_FILE_EXTENSIONS)[number];

/**
 * Detect audio container format from magic bytes. MP3 detection is strict:
 * ID3 tags or frame sync with valid MPEG header fields.
 */
export function detectAudioFormat(data: Buffer): { ext: string; mimeType: string } {
  if (data.length >= 3 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
    return { ext: 'mp3', mimeType: 'audio/mpeg' };
  }
  if (data.length >= 4 && data[0] === 0xff && (data[1]! & 0xe0) === 0xe0) {
    const b1 = data[1]!;
    const b2 = data[2]!;
    const versionBits = (b1 >> 3) & 0x03;
    const layerBits = (b1 >> 1) & 0x03;
    const bitrateIndex = (b2 >> 4) & 0x0f;
    const sampleRateIndex = (b2 >> 2) & 0x03;
    if (
      versionBits !== 0x01 &&
      layerBits !== 0x00 &&
      bitrateIndex !== 0x0f &&
      sampleRateIndex !== 0x03
    ) {
      return { ext: 'mp3', mimeType: 'audio/mpeg' };
    }
  }
  if (data.length >= 12) {
    const riff = data.subarray(0, 4).toString('ascii');
    const wave = data.subarray(8, 12).toString('ascii');
    if (riff === 'RIFF' && wave === 'WAVE') {
      return { ext: 'wav', mimeType: 'audio/wav' };
    }
  }
  if (data.length >= 4) {
    const magic = data.subarray(0, 4).toString('ascii');
    if (magic === 'fLaC') return { ext: 'flac', mimeType: 'audio/flac' };
    if (magic === 'OggS') return { ext: 'ogg', mimeType: 'audio/ogg' };
  }
  return { ext: 'pcm', mimeType: 'audio/pcm' };
}

export function getAudioFormat(filePath: string): FileAudioFormat | undefined {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return (FILE_AUDIO_FORMATS as readonly string[]).includes(ext)
    ? (ext as FileAudioFormat)
    : undefined;
}

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

function formatFromContentType(ct: string | null): AudioFormat | undefined {
  if (!ct) return undefined;
  const mime = ct.split(';')[0]!.trim().toLowerCase();
  if (!mime.startsWith('audio/')) return undefined;
  return mimeSubtypeToFormat(mime.slice(6));
}

export interface AudioData {
  data: string;
  format: AudioFormat;
}

export async function prepareAudioData(source: string): Promise<AudioData> {
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
    if (approxBytes > getMaxAudioInputBytes()) throw new Error('Data URL too large');
    return { data: parsed.base64, format };
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    const { buffer, contentType } = await fetchHttpResource(source, {
      timeoutMs: getFetchTimeoutMs(),
      maxBytes: getMaxAudioInputBytes(),
      maxRedirects: getMaxRedirects(),
    });
    const urlPath = new URL(source).pathname;
    const format = getAudioFormat(urlPath) ?? formatFromContentType(contentType);
    if (!format) {
      throw new Error(
        `Could not determine audio format from URL: ${source}. Supported: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
      );
    }
    return { data: buffer.toString('base64'), format };
  }

  const safe = await resolveSafeInputPath(source);
  const format = getAudioFormat(safe);
  if (!format) {
    throw new Error(
      `Unsupported audio format for file: ${source}. Supported: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
    );
  }
  const { size } = await fs.stat(safe);
  assertWithinAudioInputLimit(size, 'Audio file');
  const buffer = await fs.readFile(safe);
  return { data: buffer.toString('base64'), format };
}

/** Map a speech_to_text file extension to the upstream format slug. */
export function sttFormatFromExtension(ext: string): string {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  switch (normalized) {
    case 'mp3':
      return 'mp3';
    case 'mp4':
    case 'm4a':
      return 'mp4';
    case 'wav':
      return 'wav';
    case 'flac':
      return 'flac';
    case 'ogg':
    case 'oga':
      return 'ogg';
    case 'webm':
      return 'webm';
    case 'opus':
      return 'opus';
    default:
      throw new Error(
        `Unsupported audio format for file extension '.${normalized}'. Supported: ${STT_FILE_EXTENSIONS.join(', ')}.`,
      );
  }
}

function sttFormatFromMimeSubtype(subtype: string): string | undefined {
  const lower = subtype.toLowerCase();
  switch (lower) {
    case 'mpeg':
    case 'mp3':
      return 'mp3';
    case 'wav':
    case 'wave':
      return 'wav';
    case 'flac':
      return 'flac';
    case 'ogg':
      return 'ogg';
    case 'webm':
      return 'webm';
    case 'opus':
      return 'opus';
    case 'mp4':
    case 'm4a':
    case 'x-m4a':
      return 'mp4';
    default:
      if ((STT_FILE_EXTENSIONS as readonly string[]).includes(lower)) {
        return sttFormatFromExtension(lower);
      }
      return undefined;
  }
}

function assertWithinAudioInputLimit(byteCount: number, label: string): void {
  const maxBytes = getMaxAudioInputBytes();
  if (byteCount > maxBytes) {
    throw new Error(`${label} too large (${byteCount} bytes, max ${maxBytes})`);
  }
}

/** Resolve speech_to_text audio from data URL, HTTP URL, or sandboxed local file. */
export async function resolveSpeechToTextAudio(
  audioPath: string,
): Promise<{ data: string; format: string }> {
  const trimmed = audioPath.trim();
  if (!trimmed) throw new Error('audio_path is empty');

  if (trimmed.startsWith('data:')) {
    const parsed = parseBase64DataUrl(trimmed);
    if (!parsed || !parsed.mediaType.startsWith('audio/')) {
      throw new Error('Invalid audio data URL format');
    }
    const approxBytes = Math.ceil((parsed.base64.length * 3) / 4);
    assertWithinAudioInputLimit(approxBytes, 'Data URL');
    const format = sttFormatFromMimeSubtype(parsed.mediaType.split('/')[1] ?? '');
    if (!format) {
      throw new Error(
        `Unsupported audio format from MIME: ${parsed.mediaType}. Supported: ${STT_FILE_EXTENSIONS.join(', ')}.`,
      );
    }
    return { data: parsed.base64, format };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const { buffer, contentType } = await fetchHttpResource(trimmed, {
      timeoutMs: getFetchTimeoutMs(),
      maxBytes: getMaxAudioInputBytes(),
      maxRedirects: getMaxRedirects(),
    });
    assertWithinAudioInputLimit(buffer.length, 'Audio download');
    const ext = path.extname(new URL(trimmed).pathname);
    let format: string | undefined;
    if (ext) {
      try {
        format = sttFormatFromExtension(ext);
      } catch {
        format = undefined;
      }
    }
    format =
      format ??
      (contentType
        ? sttFormatFromMimeSubtype(
            contentType
              .split(';')[0]!
              .trim()
              .toLowerCase()
              .replace(/^audio\//, ''),
          )
        : undefined);
    if (!format) {
      throw new Error(
        `Unsupported audio format from URL: ${trimmed}. Supported: ${STT_FILE_EXTENSIONS.join(', ')}.`,
      );
    }
    return { data: buffer.toString('base64'), format };
  }

  const abs = await resolveSafeInputPath(trimmed);
  const { size } = await fs.stat(abs);
  assertWithinAudioInputLimit(size, 'Audio file');
  const buf = await fs.readFile(abs);
  const format = sttFormatFromExtension(path.extname(abs));
  return { data: buf.toString('base64'), format };
}
