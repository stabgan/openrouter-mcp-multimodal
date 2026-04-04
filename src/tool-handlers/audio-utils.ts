import path from 'path';
import { promises as fs } from 'fs';
import dns from 'node:dns/promises';

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 8;
const DEFAULT_MAX_DATA_URL_BYTES = 20 * 1024 * 1024;

function readEnvInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

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

/** Supported audio formats for OpenRouter */
export const SUPPORTED_AUDIO_FORMATS = [
  'wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac', 'm4a', 'pcm16', 'pcm24'
] as const;

export type AudioFormat = typeof SUPPORTED_AUDIO_FORMATS[number];

/**
 * Get audio format from file extension.
 * Returns undefined if format is not recognized/supported.
 */
export function getAudioFormat(filePath: string): AudioFormat | undefined {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return SUPPORTED_AUDIO_FORMATS.includes(ext as AudioFormat) 
    ? (ext as AudioFormat) 
    : undefined;
}

/**
 * Get MIME type for audio format.
 */
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

/**
 * Map MIME subtype to audio format.
 * Handles common aliases (e.g., mpeg -> mp3).
 */
function mimeSubtypeToFormat(subtype: string): AudioFormat | undefined {
  const aliasMap: Record<string, AudioFormat> = {
    mpeg: 'mp3',  // audio/mpeg is the standard MIME for MP3
    wav: 'wav',
    wave: 'wav',  // audio/wave is an alias
    mp3: 'mp3',
    flac: 'flac',
    ogg: 'ogg',
    aac: 'aac',
    'x-aac': 'aac',
    m4a: 'm4a',
    mp4: 'm4a',  // audio/mp4 for m4a files
    aiff: 'aiff',
    'x-aiff': 'aiff',
    pcm: 'pcm16',
  };
  return aliasMap[subtype.toLowerCase()] ?? 
    (SUPPORTED_AUDIO_FORMATS.includes(subtype as AudioFormat) ? subtype as AudioFormat : undefined);
}

function ipv4ToUint(ip: string): number {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error('Invalid IPv4');
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Blocks RFC1918, loopback, link-local, CGNAT, metadata (e.g. 169.254.169.254). */
export function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToUint(ip);
  if (n >>> 24 === 127) return true;
  if (n >>> 24 === 10) return true;
  if (n >>> 20 === 0xac1) return true;
  if (n >>> 16 === 0xc0a8) return true;
  if (n >>> 16 === 0xa9fe) return true;
  if (n >>> 24 === 0) return true;
  if (n >= 0x64400000 && n <= 0x647fffff) return true;
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const raw = ip.includes('%') ? ip.split('%')[0]! : ip;
  const x = raw.toLowerCase();
  if (x === '::1') return true;
  if (x.startsWith('fe80:') || x.startsWith('fec0:')) return true;
  const first = x.split(':').find((p) => p.length > 0);
  if (first) {
    const v = parseInt(first, 16);
    if (!Number.isNaN(v) && v >= 0xfc00 && v <= 0xfdff) return true;
  }
  return false;
}

function isIPv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Resolve hostname and ensure the resolved address is not private/link-local. */
export async function assertUrlSafeForFetch(urlString: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP(S) audio URLs are allowed');
  }
  if (url.username || url.password) {
    throw new Error('URL with credentials is not allowed');
  }

  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Blocked host');
  }

  if (isIPv4Literal(host)) {
    if (isBlockedIPv4(host)) throw new Error('Blocked host');
    return url;
  }

  if (host.includes(':') && !host.startsWith('[')) {
    if (isBlockedIPv6(host)) throw new Error('Blocked host');
    return url;
  }

  let lookupHost = host;
  if (host.startsWith('[') && host.endsWith(']')) {
    lookupHost = host.slice(1, -1);
    if (isBlockedIPv6(lookupHost)) throw new Error('Blocked host');
    return url;
  }

  const records = await dns.lookup(lookupHost, { all: true, verbatim: true });
  if (!records.length) throw new Error('Could not resolve host');

  for (const r of records) {
    const { address, family } = r;
    if (family === 4) {
      if (isBlockedIPv4(address)) throw new Error('Blocked host');
    } else if (family === 6) {
      if (isBlockedIPv6(address)) throw new Error('Blocked host');
    }
  }

  return url;
}

async function readResponseBodyWithLimit(res: Response, maxBytes: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('Response too large');
    return buf;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error('Response too large');
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function fetchHttpAudio(urlString: string): Promise<Buffer> {
  const maxBytes = getMaxDownloadBytes();
  const timeoutMs = getFetchTimeoutMs();
  const maxRedirects = getMaxRedirects();
  let current = urlString;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await assertUrlSafeForFetch(current);
    const target = validated.href;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(target, { redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(t);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirect without Location header');
      current = new URL(loc, target).href;
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return readResponseBodyWithLimit(res, maxBytes);
  }

  throw new Error('Too many redirects');
}

export interface AudioData {
  data: string; // base64-encoded audio data
  format: AudioFormat;
}

/**
 * Fetch audio from source and return base64-encoded data with format.
 * Source can be:
 * - A data URL (data:audio/xxx;base64,...)
 * - An HTTP/HTTPS URL
 * - A local file path
 * 
 * Note: OpenRouter requires audio to be base64-encoded; direct URLs are NOT supported.
 */
export async function prepareAudioData(source: string): Promise<AudioData> {
  // Handle data URL
  if (source.startsWith('data:')) {
    const match = source.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL format');
    
    const mime = match[1]!;
    const b64 = match[2]!;
    
    // Extract format from MIME type using alias-aware mapping
    const formatFromMime = mimeSubtypeToFormat(mime.split('/')[1] ?? '');
    if (!formatFromMime) {
      throw new Error(`Unsupported audio format from MIME: ${mime}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`);
    }
    
    const approxBytes = Math.ceil((b64.length * 3) / 4);
    if (approxBytes > getMaxDataUrlBytes()) throw new Error('Data URL too large');
    
    return { data: b64, format: formatFromMime as AudioFormat };
  }

  // Handle HTTP URL
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const buffer = await fetchHttpAudio(source);
    // Try to extract format from URL path
    const urlPath = new URL(source).pathname;
    const format = getAudioFormat(urlPath);
    if (!format) {
      throw new Error(`Could not determine audio format from URL: ${source}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`);
    }
    return { data: buffer.toString('base64'), format };
  }

  // Handle local file path
  const format = getAudioFormat(source);
  if (!format) {
    throw new Error(`Unsupported audio format for file: ${source}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`);
  }
  
  const buffer = await fs.readFile(source);
  return { data: buffer.toString('base64'), format };
}
