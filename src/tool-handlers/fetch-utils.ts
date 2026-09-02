/**
 * Shared network/security utilities for fetching remote resources.
 * Used by both image-utils and audio-utils to avoid duplication.
 */
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, RequestOptions } from 'node:http';
import type { LookupFunction } from 'node:net';
import net from 'node:net';
import type { Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * User-Agent for outbound fetches — some CDNs reject requests without one.
 */
export const FETCH_USER_AGENT: string = (() => {
  const fallback =
    'openrouter-mcp-multimodal/dev (+https://github.com/stabgan/openrouter-mcp-multimodal)';
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (let hop = 0; hop < 5; hop++) {
      const candidate = path.resolve(here, '../'.repeat(hop), 'package.json');
      try {
        const raw = readFileSync(candidate, 'utf8');
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg?.version && pkg?.name?.includes('openrouter-mcp-multimodal')) {
          return `openrouter-mcp-multimodal/${pkg.version} (+https://github.com/stabgan/openrouter-mcp-multimodal)`;
        }
      } catch {
        /* keep walking */
      }
    }
  } catch {
    /* fall through */
  }
  return fallback;
})();

export function readEnvInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** Normalize dotted / decimal / octal / shorthand IPv4 literals via the URL parser. */
function normalizeIPv4Literal(host: string): string | null {
  const trimmed = host.trim().toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(`http://${trimmed}/`);
    const h = parsed.hostname;
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) ? h : null;
  } catch {
    return null;
  }
}

function ipv4ToUint(ip: string): number {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error('Invalid IPv4');
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

/** Blocks RFC1918, loopback, link-local, CGNAT, metadata. */
export function isBlockedIPv4(ip: string): boolean {
  const normalized = normalizeIPv4Literal(ip);
  if (!normalized) return false;
  const n = ipv4ToUint(normalized);
  if (n >>> 24 === 127) return true;
  if (n >>> 24 === 10) return true;
  if (n >>> 20 === 0xac1) return true;
  if (n >>> 16 === 0xc0a8) return true;
  if (n >>> 16 === 0xa9fe) return true;
  if (n >>> 24 === 0) return true;
  if (n >= 0x64400000 && n <= 0x647fffff) return true;
  return false;
}

/** Expand an IPv6 literal to eight 16-bit groups, or null if invalid. */
function expandIPv6(ip: string): number[] | null {
  const noZone = ip.includes('%') ? ip.split('%')[0]! : ip;
  const noBrackets = noZone.replace(/^\[|\]$/g, '');
  if (!net.isIPv6(noBrackets)) return null;

  let addr = noBrackets.toLowerCase();

  let v4Tail: [number, number] | null = null;
  const dotIndex = addr.indexOf('.');
  if (dotIndex >= 0) {
    const lastColon = addr.lastIndexOf(':', dotIndex);
    if (lastColon < 0) return null;
    const tail = addr.slice(lastColon + 1);
    const parts = tail.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return null;
    }
    v4Tail = [((parts[0]! << 8) | parts[1]!) & 0xffff, ((parts[2]! << 8) | parts[3]!) & 0xffff];

    const hex6 = v4Tail[0].toString(16);
    const hex7 = v4Tail[1].toString(16);
    addr = addr.slice(0, lastColon) + ':' + hex6 + ':' + hex7;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 2) {
    if (missing < 0) return null;
  } else {
    if (missing !== 0) return null;
  }
  const zeros = Array<string>(Math.max(0, missing)).fill('0');
  const hexGroups = [...left, ...zeros, ...right];
  if (hexGroups.length !== 8) return null;

  const out: number[] = [];
  for (const g of hexGroups) {
    if (g.length === 0 || g.length > 4 || !/^[0-9a-f]+$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out.length === 8 ? out : null;
}

/** SSRF block list for IPv6 literals (private/reserved ranges). */
export function isBlockedIPv6(ip: string): boolean {
  const groups = expandIPv6(ip);
  if (!groups) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 0
  ) {
    return true;
  }

  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 1
  ) {
    return true;
  }

  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    const v4 = ((g6 << 16) >>> 0) | g7;
    const dotted = `${(v4 >>> 24) & 0xff}.${(v4 >>> 16) & 0xff}.${(v4 >>> 8) & 0xff}.${v4 & 0xff}`;
    return isBlockedIPv4(dotted);
  }

  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    if (g6 !== 0 || g7 !== 0) {
      const v4 = ((g6 << 16) >>> 0) | g7;
      const dotted = `${(v4 >>> 24) & 0xff}.${(v4 >>> 16) & 0xff}.${(v4 >>> 8) & 0xff}.${v4 & 0xff}`;
      return isBlockedIPv4(dotted);
    }
  }

  if ((g0 & 0xfe00) === 0xfc00) return true;

  if ((g0 & 0xffc0) === 0xfe80) return true;

  if ((g0 & 0xffc0) === 0xfec0) return true;

  if ((g0 & 0xff00) === 0xff00) return true;

  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;

  if (g0 === 0x2001 && g1 === 0x0db8) return true;

  if (g0 === 0x2001 && g1 === 0x0000) return true;

  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0010) return true;
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0020) return true;

  if (g0 === 0x2002) {
    const v4 = ((g1 << 16) >>> 0) | g2;
    const dotted = `${(v4 >>> 24) & 0xff}.${(v4 >>> 16) & 0xff}.${(v4 >>> 8) & 0xff}.${v4 & 0xff}`;
    return isBlockedIPv4(dotted);
  }

  return false;
}

function isIPv4Literal(host: string): boolean {
  return normalizeIPv4Literal(host) !== null;
}

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

interface ValidatedFetchTarget {
  url: URL;
  addresses: PinnedAddress[];
}

type DnsLookupHook = (host: string) => Promise<PinnedAddress[]>;

/** Vitest-only hooks; inert outside `process.env.VITEST === 'true'`. */
let testDnsLookup: DnsLookupHook | null = null;
let testTrustedCa: string | undefined;
let testAllowLoopbackResolution = false;

/** @internal Test seam — never active in production. */
export function __setFetchUtilsTestHooks(hooks: {
  dnsLookup?: DnsLookupHook | null;
  trustedCa?: string;
  allowLoopbackResolution?: boolean;
}): void {
  if (process.env.VITEST !== 'true') return;
  if ('dnsLookup' in hooks) testDnsLookup = hooks.dnsLookup ?? null;
  if ('trustedCa' in hooks) testTrustedCa = hooks.trustedCa;
  if ('allowLoopbackResolution' in hooks) {
    testAllowLoopbackResolution = hooks.allowLoopbackResolution ?? false;
  }
}

/** @internal Test seam — never active in production. */
export function __resetFetchUtilsTestHooks(): void {
  testDnsLookup = null;
  testTrustedCa = undefined;
  testAllowLoopbackResolution = false;
}

function isAddressBlocked(address: string, family: 4 | 6): boolean {
  if (family === 4) return isBlockedIPv4(address);
  return isBlockedIPv6(address);
}

function isLoopbackForTest(address: string, family: 4 | 6): boolean {
  if (family === 4) {
    const normalized = normalizeIPv4Literal(address);
    if (!normalized) return false;
    return ipv4ToUint(normalized) >>> 24 === 127;
  }
  const groups = expandIPv6(address);
  if (!groups) return false;
  return (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0 &&
    groups[6] === 0 &&
    groups[7] === 1
  );
}

function assertAddressAllowed(address: string, family: 4 | 6): void {
  if (
    testAllowLoopbackResolution &&
    process.env.VITEST === 'true' &&
    isLoopbackForTest(address, family)
  ) {
    return;
  }
  if (isAddressBlocked(address, family)) throw new Error('Blocked host');
}

async function lookupHostAddresses(host: string): Promise<PinnedAddress[]> {
  if (testDnsLookup && process.env.VITEST === 'true') {
    return testDnsLookup(host);
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  return records.map((r) => ({
    address: r.address,
    family: r.family === 6 ? 6 : 4,
  }));
}

async function validateUrlAndResolveAddresses(urlString: string): Promise<ValidatedFetchTarget> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP(S) URLs are allowed');
  }
  if (url.username || url.password) {
    throw new Error('URL with credentials is not allowed');
  }

  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Blocked host');
  }

  if (isIPv4Literal(host)) {
    const normalized = normalizeIPv4Literal(host)!;
    assertAddressAllowed(normalized, 4);
    return { url, addresses: [{ address: normalized, family: 4 }] };
  }

  if (host.includes(':') && !host.startsWith('[')) {
    assertAddressAllowed(host, 6);
    return { url, addresses: [{ address: host, family: 6 }] };
  }

  let lookupHost = host;
  if (host.startsWith('[') && host.endsWith(']')) {
    lookupHost = host.slice(1, -1);
    assertAddressAllowed(lookupHost, 6);
    return { url, addresses: [{ address: lookupHost, family: 6 }] };
  }

  const records = await lookupHostAddresses(lookupHost);
  if (!records.length) throw new Error('Could not resolve host');

  const addresses: PinnedAddress[] = [];
  for (const r of records) {
    assertAddressAllowed(r.address, r.family);
    addresses.push(r);
  }

  return { url, addresses };
}

/** Resolve hostname and ensure the resolved address is not private/link-local. */
export async function assertUrlSafeForFetch(urlString: string): Promise<URL> {
  const { url } = await validateUrlAndResolveAddresses(urlString);
  return url;
}

// Pin the socket to a pre-validated IP so connect-time DNS cannot rebind to private space.
function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  const deliver = (
    cb: (err: NodeJS.ErrnoException | null, address: string, family?: number) => void,
  ): void => {
    cb(null, address, family);
  };

  return (hostname, options, callback) => {
    if (typeof options === 'function') {
      deliver(options);
      return;
    }
    if (!callback) return;
    const opts = typeof options === 'number' ? { family: options } : (options ?? {});
    if (opts.all) {
      callback(null, [{ address, family }]);
      return;
    }
    deliver(callback);
  };
}

function isConnectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'EPIPE'
  );
}

function requestPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

function buildRequestOptions(url: URL, pinned: PinnedAddress, timeoutMs: number): RequestOptions {
  return {
    hostname: url.hostname,
    host: url.host,
    port: requestPort(url),
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers: {
      'User-Agent': FETCH_USER_AGENT,
      Accept: 'image/*, audio/*, video/*, */*;q=0.8',
      // Prefer identity; decompress defensively if the origin ignores this.
      'Accept-Encoding': 'identity',
      Host: url.host,
    },
    lookup: pinnedLookup(pinned.address, pinned.family),
    signal: AbortSignal.timeout(timeoutMs),
  };
}

function pinnedHttpRequest(
  url: URL,
  pinned: PinnedAddress,
  timeoutMs: number,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const options = buildRequestOptions(url, pinned, timeoutMs);
    const req = http.request(options, (res) => resolve(res));
    req.on('error', (err) => {
      if (options.signal?.aborted) {
        reject(new Error('Fetch timed out'));
        return;
      }
      reject(err);
    });
    req.end();
  });
}

function pinnedHttpsRequest(
  url: URL,
  pinned: PinnedAddress,
  timeoutMs: number,
  ca?: string,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const options = buildRequestOptions(url, pinned, timeoutMs);
    const req = https.request({ ...options, ca }, (res) => resolve(res));
    req.on('error', (err) => {
      if (options.signal?.aborted) {
        reject(new Error('Fetch timed out'));
        return;
      }
      reject(err);
    });
    req.end();
  });
}

async function pinnedRequest(
  url: URL,
  pinned: PinnedAddress,
  timeoutMs: number,
): Promise<IncomingMessage> {
  const ca = testTrustedCa && process.env.VITEST === 'true' ? testTrustedCa : undefined;
  if (url.protocol === 'https:') {
    return pinnedHttpsRequest(url, pinned, timeoutMs, ca);
  }
  if (url.protocol === 'http:') {
    return pinnedHttpRequest(url, pinned, timeoutMs);
  }
  throw new Error('Only HTTP(S) URLs are allowed');
}

async function pinnedRequestWithFallback(
  url: URL,
  addresses: PinnedAddress[],
  timeoutMs: number,
): Promise<IncomingMessage> {
  if (!addresses.length) throw new Error('Could not resolve host');

  let lastError: unknown;
  for (const pinned of addresses) {
    try {
      return await pinnedRequest(url, pinned, timeoutMs);
    } catch (err) {
      if (err instanceof Error && err.message === 'Fetch timed out') throw err;
      lastError = err;
      if (!isConnectError(err)) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Connection failed');
}

function drainIncomingMessage(res: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => resolve();
    res.on('end', finish);
    res.on('close', finish);
    res.on('error', finish);
    res.resume();
  });
}

type KnownContentEncoding = 'gzip' | 'x-gzip' | 'deflate' | 'br';

function parseContentEncodings(raw: string | null): KnownContentEncoding[] {
  if (!raw) return [];
  const out: KnownContentEncoding[] = [];
  for (const part of raw.split(',')) {
    const enc = part.trim().toLowerCase();
    if (!enc || enc === 'identity') continue;
    switch (enc) {
      case 'gzip':
      case 'x-gzip':
      case 'deflate':
      case 'br':
        out.push(enc);
        break;
      default:
        throw new Error(`Unsupported Content-Encoding: ${enc}`);
    }
  }
  return out;
}

function createDecompressTransform(encoding: KnownContentEncoding): Transform {
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return createGunzip();
    case 'deflate':
      return createInflate();
    case 'br':
      return createBrotliDecompress();
    default: {
      const _exhaustive: never = encoding;
      throw new Error(`Unsupported Content-Encoding: ${String(_exhaustive)}`);
    }
  }
}

function bodyStreamForResponse(
  res: IncomingMessage,
  encodings: KnownContentEncoding[],
): NodeJS.ReadableStream {
  let stream: NodeJS.ReadableStream = res;
  for (const enc of [...encodings].reverse()) {
    stream = stream.pipe(createDecompressTransform(enc));
  }
  return stream;
}

async function readIncomingMessageWithLimit(
  res: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  let encodings: KnownContentEncoding[];
  try {
    encodings = parseContentEncodings(headerValue(res.headers, 'content-encoding'));
  } catch (err) {
    await releaseIncomingMessage(res);
    throw err;
  }

  if (!encodings.length) {
    const declared = res.headers['content-length'];
    if (declared) {
      const n = parseInt(String(declared), 10);
      if (Number.isFinite(n) && n > maxBytes) {
        res.destroy();
        throw new Error('Response too large');
      }
    }
  }

  const stream = bodyStreamForResponse(res, encodings);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        res.destroy();
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          stream.destroy();
        }
        throw new Error('Response too large');
      }
      chunks.push(buf);
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Response too large') throw err;
    res.destroy();
    if ('destroy' in stream && typeof stream.destroy === 'function') {
      stream.destroy();
    }
    throw err;
  }
  return Buffer.concat(chunks);
}

async function releaseIncomingMessage(res: IncomingMessage): Promise<void> {
  await drainIncomingMessage(res);
}

function headerValue(headers: IncomingMessage['headers'], name: string): string | null {
  const raw = headers[name.toLowerCase()];
  if (raw === undefined) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

/**
 * Parse an RFC 2397 data URL into `{ mediaType, base64 }`. Accepts MIME
 * parameters (`data:audio/wav;charset=binary;base64,...`) and the bare
 * `data:;base64,...` form. Returns `null` for anything that is not a
 * base64-encoded data URL.
 */
export function parseBase64DataUrl(source: string): { mediaType: string; base64: string } | null {
  if (!source.startsWith('data:')) return null;
  const comma = source.indexOf(',');
  if (comma < 0) return null;
  const prefix = source.slice(5, comma); // between "data:" and ","
  const payload = source.slice(comma + 1);
  const parts = prefix.split(';').map((p) => p.trim());
  const hasBase64 = parts[parts.length - 1]?.toLowerCase() === 'base64';
  if (!hasBase64) return null;
  const mediaType = (
    parts[0] && parts[0].includes('/') ? parts[0] : 'application/octet-stream'
  ).toLowerCase();
  return { mediaType, base64: payload };
}

export interface FetchOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
}

/**
 * Fetch a remote HTTP(S) resource with SSRF protection, size limits,
 * redirect cap, and timeout. Returns body Buffer + Content-Type header.
 */
export async function fetchHttpResource(
  urlString: string,
  opts: FetchOptions,
): Promise<{ buffer: Buffer; contentType: string | null }> {
  let current = urlString;

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const { url: validated, addresses } = await validateUrlAndResolveAddresses(current);
    const target = validated.href;

    let res: IncomingMessage;
    try {
      res = await pinnedRequestWithFallback(validated, addresses, opts.timeoutMs);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Fetch timed out') {
        throw new Error('Fetch timed out');
      }
      throw err;
    }

    const statusCode = res.statusCode ?? 0;
    if (statusCode >= 300 && statusCode < 400) {
      const loc = headerValue(res.headers, 'location');
      await releaseIncomingMessage(res);
      if (!loc) throw new Error('Redirect without Location header');
      current = new URL(loc, target).href;
      continue;
    }

    if (statusCode < 200 || statusCode >= 300) {
      await releaseIncomingMessage(res);
      throw new Error(`HTTP ${statusCode}`);
    }

    const buffer = await readIncomingMessageWithLimit(res, opts.maxBytes);
    return { buffer, contentType: headerValue(res.headers, 'content-type') };
  }

  throw new Error('Too many redirects');
}
