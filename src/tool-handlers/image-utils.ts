import path from 'path';
import { promises as fs } from 'fs';
import dns from 'node:dns/promises';

const DEFAULT_MAX_DIMENSION = 800;
const DEFAULT_JPEG_QUALITY = 80;
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
      console.error('sharp not available, images will be sent unprocessed');
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
    throw new Error('Only HTTP(S) image URLs are allowed');
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

export async function fetchHttpImage(urlString: string): Promise<Buffer> {
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

export async function fetchImage(source: string): Promise<Buffer> {
  if (source.startsWith('data:')) {
    const match = source.match(/^data:[^;]+;base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    const b64 = match[1];
    const approxBytes = Math.ceil((b64.length * 3) / 4);
    if (approxBytes > getMaxDataUrlBytes()) throw new Error('Data URL too large');
    return Buffer.from(b64, 'base64');
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    return fetchHttpImage(source);
  }

  return fs.readFile(source);
}

export async function optimizeImage(buffer: Buffer): Promise<string> {
  const sharp = await loadSharp();
  if (!sharp) return buffer.toString('base64');

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
    return out.toString('base64');
  } catch {
    return buffer.toString('base64');
  }
}

export async function prepareImageUrl(source: string): Promise<string> {
  if (source.startsWith('data:')) return source;

  const buffer = await fetchImage(source);
  const base64 = await optimizeImage(buffer);
  const mime = source.startsWith('http') ? 'image/jpeg' : getMimeType(source);
  return `data:${mime};base64,${base64}`;
}
