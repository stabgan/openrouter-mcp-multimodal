import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import dns from 'node:dns/promises';
import {
  fetchHttpResource,
  assertUrlSafeForFetch,
  __setFetchUtilsTestHooks,
  __resetFetchUtilsTestHooks,
} from '../tool-handlers/fetch-utils.js';

afterEach(() => {
  __resetFetchUtilsTestHooks();
  vi.restoreAllMocks();
});

interface LocalServer {
  server: http.Server | https.Server;
  port: number;
  url: (path?: string) => string;
}

function listenHttp(handler: http.RequestListener): Promise<LocalServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve({
        server,
        port: addr.port,
        url: (path = '/') => `http://127.0.0.1:${addr.port}${path}`,
      });
    });
  });
}

function listenHttps(
  cert: string,
  key: string,
  handler: http.RequestListener,
): Promise<LocalServer & { hostname: string }> {
  return new Promise((resolve, reject) => {
    const server = https.createServer({ cert, key }, handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve({
        server,
        port: addr.port,
        hostname: 'pinned-https.test',
        url: (path = '/') => `https://pinned-https.test:${addr.port}${path}`,
      });
    });
  });
}

function closeServer(server: http.Server | https.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function generateTestCert(): { cert: string; key: string } {
  const out = execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      '/dev/stdout',
      '-out',
      '/dev/stdout',
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=pinned-https.test',
    ],
    { encoding: 'utf8' },
  );
  const keyMatch = out.match(/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/);
  const certMatch = out.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!keyMatch || !certMatch) throw new Error('openssl PEM generation failed');
  return { key: keyMatch[0], cert: certMatch[0] };
}

describe('fetchHttpResource — pinned IP transport', () => {
  it('fetches HTTP from a loopback server when test DNS pins to validated 127.0.0.1', async () => {
    let hit = false;
    const { server, port } = await listenHttp((_req, res) => {
      hit = true;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello-pinned');
    });

    __setFetchUtilsTestHooks({
      allowLoopbackResolution: true,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    try {
      const { buffer, contentType } = await fetchHttpResource(
        `http://loopback.test:${port}/resource`,
        {
          timeoutMs: 5000,
          maxBytes: 4096,
          maxRedirects: 0,
        },
      );
      expect(hit).toBe(true);
      expect(buffer.toString()).toBe('hello-pinned');
      expect(contentType).toBe('text/plain');
    } finally {
      await closeServer(server);
    }
  });

  it('fetches HTTPS end-to-end with TLS verification against a test CA', async () => {
    const { cert, key } = generateTestCert();
    let hit = false;
    const { server, url } = await listenHttps(cert, key, (_req, res) => {
      hit = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });

    __setFetchUtilsTestHooks({
      allowLoopbackResolution: true,
      trustedCa: cert,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    try {
      const { buffer } = await fetchHttpResource(url('/secure'), {
        timeoutMs: 5000,
        maxBytes: 4096,
        maxRedirects: 0,
      });
      expect(hit).toBe(true);
      expect(buffer.toString()).toBe('{"ok":true}');
    } finally {
      await closeServer(server);
    }
  });

  it('blocks DNS rebinding: validation sees public IP, connect cannot reach loopback', async () => {
    const secret = 'REBOUND-SECRET';
    let localhostHit = false;
    const { server, port } = await listenHttp((_req, res) => {
      localhostHit = true;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(secret);
    });

    __setFetchUtilsTestHooks({
      dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }],
    });

    try {
      await expect(
        fetchHttpResource(`http://rebind.evil.test:${port}/`, {
          timeoutMs: 3000,
          maxBytes: 4096,
          maxRedirects: 0,
        }),
      ).rejects.toThrow();
      expect(localhostHit).toBe(false);
    } finally {
      await closeServer(server);
    }
  });

  it('proves validation-time and connect-time DNS can diverge (pre-fix baseline)', async () => {
    const secret = 'OLD-CONNECT-LEAKED';
    let localhostHit = false;
    const { server, port } = await listenHttp((_req, res) => {
      localhostHit = true;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(secret);
    });

    const hostname = 'rebind-baseline.test';
    vi.spyOn(dns, 'lookup').mockImplementation(async (host, options) => {
      if (host !== hostname) throw new Error(`unexpected host ${host}`);
      if (typeof options === 'object' && options !== null && 'all' in options && options.all) {
        return [{ address: '8.8.8.8', family: 4 }];
      }
      return { address: '8.8.8.8', family: 4 };
    });

    try {
      await assertUrlSafeForFetch(`http://${hostname}:${port}/`);
      const body = await new Promise<string>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/`, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(Buffer.from(c)));
            res.on('end', () => resolve(Buffer.concat(chunks).toString()));
          })
          .on('error', reject);
      });
      expect(localhostHit).toBe(true);
      expect(body).toBe(secret);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects redirect hop that resolves to a private address', async () => {
    const { server, port } = await listenHttp((_req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end('redirect-body');
    });

    __setFetchUtilsTestHooks({
      allowLoopbackResolution: true,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    try {
      await expect(
        fetchHttpResource(`http://redirect.test:${port}/start`, {
          timeoutMs: 5000,
          maxBytes: 4096,
          maxRedirects: 3,
        }),
      ).rejects.toThrow('Blocked host');
    } finally {
      await closeServer(server);
    }
  });

  it('follows a safe redirect and re-pins the next hop', async () => {
    const finalBody = 'final-hop';
    const { server: second, port: secondPort } = await listenHttp((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(finalBody);
    });
    const secondUrl = `http://final.test:${secondPort}/final`;
    const { server: first, port: firstPort } = await listenHttp((_req, res) => {
      res.writeHead(302, { Location: secondUrl });
      res.end('hop1');
    });

    __setFetchUtilsTestHooks({
      allowLoopbackResolution: true,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    try {
      const { buffer } = await fetchHttpResource(`http://first.test:${firstPort}/start`, {
        timeoutMs: 5000,
        maxBytes: 4096,
        maxRedirects: 3,
      });
      expect(buffer.toString()).toBe(finalBody);
    } finally {
      await closeServer(first);
      await closeServer(second);
    }
  });

  it('enforces maxBytes mid-stream without Content-Length', async () => {
    const { server, port } = await listenHttp((_req, res) => {
      res.writeHead(200);
      res.write(Buffer.alloc(512));
      res.end(Buffer.alloc(512));
    });

    __setFetchUtilsTestHooks({
      allowLoopbackResolution: true,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    try {
      await expect(
        fetchHttpResource(`http://stream.test:${port}/big`, {
          timeoutMs: 5000,
          maxBytes: 600,
          maxRedirects: 0,
        }),
      ).rejects.toThrow('Response too large');
    } finally {
      await closeServer(server);
    }
  });

  it('times out slow responses', async () => {
    const { server, port } = await listenHttp((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end('late');
      }, 500);
    });

    __setFetchUtilsTestHooks({
      allowLoopbackResolution: true,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    try {
      await expect(
        fetchHttpResource(`http://slow.test:${port}/slow`, {
          timeoutMs: 100,
          maxBytes: 4096,
          maxRedirects: 0,
        }),
      ).rejects.toThrow('Fetch timed out');
    } finally {
      await closeServer(server);
    }
  });

  it('destroys the socket when a redirect target is blocked', async () => {
    let socketClosed = false;
    const { server, port } = await listenHttp((_req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/' });
      res.on('close', () => {
        socketClosed = true;
      });
      res.end('redirect-payload');
    });

    __setFetchUtilsTestHooks({
      allowLoopbackResolution: true,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    try {
      await expect(
        fetchHttpResource(`http://redirect.test:${port}/meta`, {
          timeoutMs: 5000,
          maxBytes: 4096,
          maxRedirects: 3,
        }),
      ).rejects.toThrow('Blocked host');
      await new Promise((r) => setTimeout(r, 50));
      expect(socketClosed).toBe(true);
    } finally {
      await closeServer(server);
    }
  });
});
