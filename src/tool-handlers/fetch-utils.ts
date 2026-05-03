/**
 * Shared network/security utilities for fetching remote resources.
 * Used by both image-utils and audio-utils to avoid duplication.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * User-Agent we send on outbound fetches from `fetchHttpResource`. Some
 * CDNs/WAFs (notably Wikimedia/Varnish) reject requests without a UA, so
 * we identify ourselves with the package name + current version + a repo
 * URL so origin operators can contact us if our traffic misbehaves.
 *
 * Version is read from package.json at module load so version bumps don't
 * require hand-edits here. Falls back to `dev` if package.json can't be
 * located (e.g. in certain bundled environments).
 */
export const FETCH_USER_AGENT: string = (() => {
  const fallback = 'openrouter-mcp-multimodal/dev (+https://github.com/stabgan/openrouter-mcp-multimodal)';
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // Walk up a few levels looking for package.json (handles both
    // dist/tool-handlers/… and src/tool-handlers/… layouts).
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
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function ipv4ToUint(ip: string): number {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error('Invalid IPv4');
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Blocks RFC1918, loopback, link-local, CGNAT, metadata. */
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

/**
 * Expand an IPv6 literal to eight 16-bit groups as lowercase hex without
 * separators. Accepts compressed forms (::), zone ids (%eth0), and IPv4-mapped
 * / IPv4-compatible tails. Returns null if the input is not a valid IPv6
 * literal.
 */
function expandIPv6(ip: string): number[] | null {
  // Strip optional brackets (URL host form) and zone id before validation.
  const noZone = ip.includes('%') ? ip.split('%')[0]! : ip;
  const noBrackets = noZone.replace(/^\[|\]$/g, '');
  if (!net.isIPv6(noBrackets)) return null;

  let addr = noBrackets.toLowerCase();

  // Pull out any IPv4 tail (`::ffff:a.b.c.d`, `::a.b.c.d`, `x:y::a.b.c.d`)
  // and substitute two 16-bit zero groups in its place. This way the rest
  // of the parser only needs to handle pure-hex 8-group form.
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
    // Substitute "g6:g7" in hex. E.g. "::ffff:127.0.0.1" -> "::ffff:7f00:0001"
    const hex6 = v4Tail[0].toString(16);
    const hex7 = v4Tail[1].toString(16);
    addr = addr.slice(0, lastColon) + ':' + hex6 + ':' + hex7;
  }

  // Split on "::" at most once; fill the gap with zero groups.
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

/**
 * Comprehensive IPv6 SSRF block list. Covers loopback, unspecified,
 * IPv4-mapped, IPv4-compatible, link-local, site-local, ULA, multicast,
 * discard, documentation, Teredo, 6to4 (re-validates the embedded IPv4
 * against `isBlockedIPv4`), and ORCHID. Returns `true` for any input that
 * is a valid IPv6 literal in a reserved or private range.
 *
 * For non-IPv6 input returns `false` (the caller is expected to also run
 * `isBlockedIPv4` for IPv4 input).
 */
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

  // ::  (unspecified)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 0) {
    return true;
  }
  // ::1 (loopback)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) {
    return true;
  }
  // ::ffff:0:0/96 — IPv4-mapped. Re-check the embedded IPv4.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    const v4 = ((g6 << 16) >>> 0) | g7;
    const dotted = `${(v4 >>> 24) & 0xff}.${(v4 >>> 16) & 0xff}.${(v4 >>> 8) & 0xff}.${v4 & 0xff}`;
    return isBlockedIPv4(dotted);
  }
  // ::/96 IPv4-compatible (deprecated but still routable in places).
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    // Only treat as IPv4-compat if g6/g7 actually look like an IPv4 (both
    // are nonzero or this is the all-zeros case handled above).
    if (g6 !== 0 || g7 !== 0) {
      const v4 = ((g6 << 16) >>> 0) | g7;
      const dotted = `${(v4 >>> 24) & 0xff}.${(v4 >>> 16) & 0xff}.${(v4 >>> 8) & 0xff}.${v4 & 0xff}`;
      return isBlockedIPv4(dotted);
    }
  }
  // fc00::/7 — ULA
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 — link-local
  if ((g0 & 0xffc0) === 0xfe80) return true;
  // fec0::/10 — deprecated site-local
  if ((g0 & 0xffc0) === 0xfec0) return true;
  // ff00::/8 — multicast (all forms)
  if ((g0 & 0xff00) === 0xff00) return true;
  // 100::/64 — discard prefix (RFC 6666)
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  // 2001:db8::/32 — documentation
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  // 2001::/32 — Teredo
  if (g0 === 0x2001 && g1 === 0x0000) return true;
  // 2001:10::/28, 2001:20::/28 — ORCHID / deprecated
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0010) return true;
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0020) return true;
  // 2002::/16 — 6to4; re-check embedded IPv4 for private/reserved use.
  if (g0 === 0x2002) {
    const v4 = ((g1 << 16) >>> 0) | g2;
    const dotted = `${(v4 >>> 24) & 0xff}.${(v4 >>> 16) & 0xff}.${(v4 >>> 8) & 0xff}.${v4 & 0xff}`;
    return isBlockedIPv4(dotted);
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
  const declared = res.headers.get('content-length');
  if (declared) {
    const n = parseInt(declared, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new Error('Response too large');
    }
  }
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
    if (total > maxBytes) {
      // Cancel the underlying body so the server connection can be released.
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new Error('Response too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Parse an RFC 2397 data URL into `{ mediaType, base64 }`. Accepts MIME
 * parameters (`data:audio/wav;charset=binary;base64,...`) and the bare
 * `data:;base64,...` form. Returns `null` for anything that is not a
 * base64-encoded data URL.
 */
export function parseBase64DataUrl(
  source: string,
): { mediaType: string; base64: string } | null {
  if (!source.startsWith('data:')) return null;
  const comma = source.indexOf(',');
  if (comma < 0) return null;
  const prefix = source.slice(5, comma); // between "data:" and ","
  const payload = source.slice(comma + 1);
  const parts = prefix.split(';').map((p) => p.trim());
  const hasBase64 = parts[parts.length - 1]?.toLowerCase() === 'base64';
  if (!hasBase64) return null;
  const mediaType = (parts[0] && parts[0].includes('/') ? parts[0] : 'application/octet-stream').toLowerCase();
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
    const validated = await assertUrlSafeForFetch(current);
    const target = validated.href;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(target, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Some CDNs/WAFs (notably Wikimedia/Varnish) reject requests
          // without a User-Agent with HTTP 400. Identify ourselves so
          // analyze_image / analyze_audio / analyze_video work against
          // those origins. See https://github.com/stabgan/openrouter-mcp-multimodal/issues/13
          'User-Agent': FETCH_USER_AGENT,
          Accept: 'image/*, audio/*, video/*, */*;q=0.8',
        },
      });
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
    const buffer = await readResponseBodyWithLimit(res, opts.maxBytes);
    return { buffer, contentType: res.headers.get('content-type') };
  }

  throw new Error('Too many redirects');
}
