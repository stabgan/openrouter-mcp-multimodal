import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  readEnvInt,
  isBlockedIPv4,
  assertUrlSafeForFetch,
  fetchHttpResource,
} from '../tool-handlers/fetch-utils.js';
import { replaceExtension } from '../tool-handlers/path-utils.js';

describe('readEnvInt', () => {
  it('returns fallback when env var is missing', () => {
    delete process.env['TEST_MISSING_VAR'];
    expect(readEnvInt('TEST_MISSING_VAR', 42)).toBe(42);
  });

  it('returns fallback when env var is empty', () => {
    process.env['TEST_EMPTY_VAR'] = '';
    expect(readEnvInt('TEST_EMPTY_VAR', 42)).toBe(42);
    delete process.env['TEST_EMPTY_VAR'];
  });

  it('parses valid integer', () => {
    process.env['TEST_INT_VAR'] = '100';
    expect(readEnvInt('TEST_INT_VAR', 42)).toBe(100);
    delete process.env['TEST_INT_VAR'];
  });

  it('returns fallback for non-numeric value', () => {
    process.env['TEST_NAN_VAR'] = 'abc';
    expect(readEnvInt('TEST_NAN_VAR', 42)).toBe(42);
    delete process.env['TEST_NAN_VAR'];
  });

  it('returns fallback when value is below min', () => {
    process.env['TEST_LOW_VAR'] = '0';
    expect(readEnvInt('TEST_LOW_VAR', 42, 1)).toBe(42);
    delete process.env['TEST_LOW_VAR'];
  });

  it('returns fallback for float strings', () => {
    process.env['TEST_FLOAT_VAR'] = '3.14';
    expect(readEnvInt('TEST_FLOAT_VAR', 42)).toBe(42);
    delete process.env['TEST_FLOAT_VAR'];
  });

  it('returns fallback for negative integers', () => {
    process.env['TEST_NEG_VAR'] = '-5';
    expect(readEnvInt('TEST_NEG_VAR', 42)).toBe(42);
    delete process.env['TEST_NEG_VAR'];
  });

  it('accepts large but valid integers', () => {
    process.env['TEST_HUGE_VAR'] = '999999999';
    expect(readEnvInt('TEST_HUGE_VAR', 42)).toBe(999999999);
    delete process.env['TEST_HUGE_VAR'];
  });
});

describe('isBlockedIPv4', () => {
  it('blocks loopback', () => {
    expect(isBlockedIPv4('127.0.0.1')).toBe(true);
    expect(isBlockedIPv4('127.255.255.255')).toBe(true);
  });

  it('blocks RFC1918 10.x', () => {
    expect(isBlockedIPv4('10.0.0.1')).toBe(true);
    expect(isBlockedIPv4('10.255.255.255')).toBe(true);
  });

  it('blocks RFC1918 172.16-31.x', () => {
    expect(isBlockedIPv4('172.16.0.1')).toBe(true);
    expect(isBlockedIPv4('172.31.255.255')).toBe(true);
  });

  it('blocks RFC1918 192.168.x', () => {
    expect(isBlockedIPv4('192.168.0.1')).toBe(true);
    expect(isBlockedIPv4('192.168.255.255')).toBe(true);
  });

  it('blocks link-local 169.254.x', () => {
    expect(isBlockedIPv4('169.254.169.254')).toBe(true);
  });

  it('blocks CGNAT 100.64-127.x', () => {
    expect(isBlockedIPv4('100.64.0.1')).toBe(true);
    expect(isBlockedIPv4('100.127.255.255')).toBe(true);
  });

  it('allows public IPs', () => {
    expect(isBlockedIPv4('8.8.8.8')).toBe(false);
    expect(isBlockedIPv4('1.1.1.1')).toBe(false);
    expect(isBlockedIPv4('142.250.80.46')).toBe(false);
  });

  it('blocks octal-encoded loopback literals', () => {
    expect(isBlockedIPv4('0177.0.0.1')).toBe(true);
  });

  it('blocks decimal-encoded loopback literals', () => {
    expect(isBlockedIPv4('2130706433')).toBe(true);
  });

  it('blocks 0.0.0.0', () => {
    expect(isBlockedIPv4('0.0.0.0')).toBe(true);
  });

  it('blocks shorthand loopback literals', () => {
    expect(isBlockedIPv4('127.1')).toBe(true);
  });

  it('returns false for non-IPv4 strings', () => {
    expect(isBlockedIPv4('not-an-ip')).toBe(false);
  });
});

describe('assertUrlSafeForFetch', () => {
  it('rejects localhost', async () => {
    await expect(assertUrlSafeForFetch('http://localhost/foo')).rejects.toThrow('Blocked host');
  });

  it('rejects private IPv4', async () => {
    await expect(assertUrlSafeForFetch('http://127.0.0.1/foo')).rejects.toThrow('Blocked host');
    await expect(assertUrlSafeForFetch('http://192.168.1.1/foo')).rejects.toThrow('Blocked host');
  });

  it('rejects non-HTTP protocols', async () => {
    await expect(assertUrlSafeForFetch('ftp://example.com/foo')).rejects.toThrow('Only HTTP(S)');
  });

  it('rejects URLs with credentials', async () => {
    await expect(assertUrlSafeForFetch('http://user:pass@example.com/foo')).rejects.toThrow(
      'credentials',
    );
  });

  it('rejects invalid URLs', async () => {
    await expect(assertUrlSafeForFetch('not-a-url')).rejects.toThrow('Invalid URL');
  });

  it('rejects decimal-encoded loopback in URLs', async () => {
    await expect(assertUrlSafeForFetch('http://2130706433/')).rejects.toThrow('Blocked host');
  });
});

describe('replaceExtension', () => {
  it('replaces a normal extension', () => {
    expect(replaceExtension('output.wav', 'mp3')).toBe('output.mp3');
  });

  it('appends when no extension exists', () => {
    expect(replaceExtension('output', 'wav')).toBe('output.wav');
  });

  it('treats .env as extensionless (dotfile)', () => {
    expect(replaceExtension('.env', 'json')).toBe('.env.json');
  });

  it('strips a trailing dot before replacing', () => {
    expect(replaceExtension('file.', 'png')).toBe('file.png');
  });

  it('replaces only the last extension when multiple dots are present', () => {
    expect(replaceExtension('archive.tar.gz', 'zip')).toBe('archive.tar.zip');
  });
});

describe('fetchHttpResource', () => {
  it('drains redirect response bodies before following Location', async () => {
    const http = await import('node:http');
    let firstBodyDrained = false;

    const finalServer = await new Promise<{ close: () => Promise<void>; finalUrl: string }>(
      (resolve, reject) => {
        const srv = http.createServer((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('ok');
        });
        srv.listen(0, '127.0.0.1', () => {
          const addr = srv.address();
          if (!addr || typeof addr === 'string') {
            reject(new Error('no address'));
            return;
          }
          resolve({
            finalUrl: `http://final.test:${addr.port}/final`,
            close: () => new Promise((r, j) => srv.close((e) => (e ? j(e) : r(undefined)))),
          });
        });
      },
    );

    const redirectServer = await new Promise<{ close: () => Promise<void>; startUrl: string }>(
      (resolve, reject) => {
        const srv = http.createServer((_req, res) => {
          res.on('close', () => {
            firstBodyDrained = true;
          });
          res.writeHead(302, { Location: finalServer.finalUrl });
          res.end('redirect-body');
        });
        srv.listen(0, '127.0.0.1', () => {
          const addr = srv.address();
          if (!addr || typeof addr === 'string') {
            reject(new Error('no address'));
            return;
          }
          resolve({
            startUrl: `http://first.test:${addr.port}/start`,
            close: () => new Promise((r, j) => srv.close((e) => (e ? j(e) : r(undefined)))),
          });
        });
      },
    );

    const { __setFetchUtilsTestHooks, __resetFetchUtilsTestHooks } =
      await import('../tool-handlers/fetch-utils.js');
    __setFetchUtilsTestHooks({
      allowLoopbackResolution: true,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    try {
      const { buffer } = await fetchHttpResource(redirectServer.startUrl, {
        timeoutMs: 5000,
        maxBytes: 1024,
        maxRedirects: 3,
      });
      expect(buffer.toString()).toBe('ok');
      expect(firstBodyDrained).toBe(true);
    } finally {
      __resetFetchUtilsTestHooks();
      await redirectServer.close();
      await finalServer.close();
    }
  });

  it('enforces maxBytes while streaming even without Content-Length', async () => {
    const http = await import('node:http');
    const { __setFetchUtilsTestHooks, __resetFetchUtilsTestHooks } =
      await import('../tool-handlers/fetch-utils.js');

    const srv = await new Promise<{ url: string; close: () => Promise<void> }>(
      (resolve, reject) => {
        const server = http.createServer((_req, res) => {
          res.writeHead(200);
          res.write(Buffer.alloc(512));
          res.end(Buffer.alloc(512));
        });
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (!addr || typeof addr === 'string') {
            reject(new Error('no address'));
            return;
          }
          resolve({
            url: `http://stream.test:${addr.port}/big`,
            close: () => new Promise((r, j) => server.close((e) => (e ? j(e) : r(undefined)))),
          });
        });
      },
    );

    __setFetchUtilsTestHooks({
      allowLoopbackResolution: true,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    try {
      await expect(
        fetchHttpResource(srv.url, {
          timeoutMs: 5000,
          maxBytes: 600,
          maxRedirects: 0,
        }),
      ).rejects.toThrow('Response too large');
    } finally {
      __resetFetchUtilsTestHooks();
      await srv.close();
    }
  });

  it('decompresses gzip-encoded bodies when the server ignores Accept-Encoding: identity', async () => {
    const http = await import('node:http');
    const plain = 'hello-from-gzip';
    const compressed = gzipSync(Buffer.from(plain));

    const srv = await new Promise<{ url: string; close: () => Promise<void> }>(
      (resolve, reject) => {
        const server = http.createServer((_req, res) => {
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'Content-Encoding': 'gzip',
            'Content-Length': String(compressed.length),
          });
          res.end(compressed);
        });
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (!addr || typeof addr === 'string') {
            reject(new Error('no address'));
            return;
          }
          resolve({
            url: `http://gzip.test:${addr.port}/gz`,
            close: () => new Promise((r, j) => server.close((e) => (e ? j(e) : r(undefined)))),
          });
        });
      },
    );

    const { __setFetchUtilsTestHooks, __resetFetchUtilsTestHooks } =
      await import('../tool-handlers/fetch-utils.js');
    __setFetchUtilsTestHooks({
      allowLoopbackResolution: true,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    try {
      const { buffer } = await fetchHttpResource(srv.url, {
        timeoutMs: 5000,
        maxBytes: 4096,
        maxRedirects: 0,
      });
      expect(buffer.toString()).toBe(plain);
    } finally {
      __resetFetchUtilsTestHooks();
      await srv.close();
    }
  });

  it('enforces maxBytes on decompressed output, not compressed wire size', async () => {
    const http = await import('node:http');
    const compressed = gzipSync(Buffer.alloc(2048, 'x'));

    const srv = await new Promise<{ url: string; close: () => Promise<void> }>(
      (resolve, reject) => {
        const server = http.createServer((_req, res) => {
          res.writeHead(200, { 'Content-Encoding': 'gzip' });
          res.end(compressed);
        });
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (!addr || typeof addr === 'string') {
            reject(new Error('no address'));
            return;
          }
          resolve({
            url: `http://gzip-bomb.test:${addr.port}/big`,
            close: () => new Promise((r, j) => server.close((e) => (e ? j(e) : r(undefined)))),
          });
        });
      },
    );

    const { __setFetchUtilsTestHooks, __resetFetchUtilsTestHooks } =
      await import('../tool-handlers/fetch-utils.js');
    __setFetchUtilsTestHooks({
      allowLoopbackResolution: true,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    try {
      await expect(
        fetchHttpResource(srv.url, {
          timeoutMs: 5000,
          maxBytes: 1024,
          maxRedirects: 0,
        }),
      ).rejects.toThrow('Response too large');
    } finally {
      __resetFetchUtilsTestHooks();
      await srv.close();
    }
  });
});
