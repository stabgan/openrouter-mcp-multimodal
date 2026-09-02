import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenRouterAPIClient, _internals } from '../openrouter-api.js';

const {
  parseRetryAfter,
  backoffWithJitter,
  fetchWithRetry,
  extractEmbeddedError,
  readJsonOrThrow,
} = _internals;

import type { VideoJobStatusName } from '../openrouter-api.js';

describe('VideoJobStatusName', () => {
  it('includes cancelled terminal states', () => {
    const statuses: VideoJobStatusName[] = ['cancelled', 'canceled'];
    expect(statuses).toEqual(['cancelled', 'canceled']);
  });
});

describe('parseRetryAfter', () => {
  it('returns null for missing header', () => {
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('parses integer seconds', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses HTTP-date into future milliseconds', () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(5000);
    expect(ms!).toBeLessThan(15000);
  });

  it('clamps past HTTP-date to zero', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });

  it('returns null for unparseable values', () => {
    expect(parseRetryAfter('later please')).toBeNull();
  });
});

describe('backoffWithJitter', () => {
  it('honors Retry-After when it exceeds the base backoff', () => {
    const delays = Array.from({ length: 20 }, () => backoffWithJitter(0, 2000));
    // Base (400) < retry-after (2000), so every delay should be in the
    // jittered range around 2000ms (1000 .. 3000).
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(3000);
    }
  });

  it('uses base backoff when Retry-After is null', () => {
    const delays = Array.from({ length: 20 }, () => backoffWithJitter(1, null));
    // Base for attempt=1 is 800ms; jittered 400..1200.
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(400);
      expect(d).toBeLessThanOrEqual(1200);
    }
  });

  it('clamps backoff to the 10-second ceiling', () => {
    const delays = Array.from({ length: 20 }, () => backoffWithJitter(0, 120_000));
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(15_000);
    }
  });
});

describe('fetchWithRetry', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockResponse(status: number, init: ResponseInit = {}): Response {
    const body = init.body ?? null;
    return new Response(body, { status, ...init });
  }

  it('does not retry 4xx other than 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(401));
    globalThis.fetch = fetchMock;
    const res = await fetchWithRetry('https://example.test', {}, { retries: 2, timeoutMs: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });

  it('retries 429 and cancels the response body', async () => {
    const res429 = new Response('rate limited', {
      status: 429,
      headers: { 'retry-after': '0' },
    });
    const cancelSpy = vi.spyOn(res429.body!, 'cancel').mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res429)
      .mockResolvedValueOnce(mockResponse(200));
    globalThis.fetch = fetchMock;

    const promise = fetchWithRetry('https://example.test', {}, { retries: 2, timeoutMs: 1000 });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cancelSpy).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('retries network errors and rethrows the last error', async () => {
    const netErr = new Error('ECONNRESET');
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(netErr)
      .mockRejectedValueOnce(netErr)
      .mockRejectedValueOnce(netErr);
    globalThis.fetch = fetchMock;

    const promise = fetchWithRetry('https://example.test', {}, { retries: 2, timeoutMs: 1000 });
    const rejection = expect(promise).rejects.toThrow('ECONNRESET');
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns the final 5xx response after exhausting retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(503));
    globalThis.fetch = fetchMock;

    const promise = fetchWithRetry('https://example.test', {}, { retries: 2, timeoutMs: 1000 });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(503);
  });

  it('creates a fresh AbortSignal.timeout per attempt', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200));
    globalThis.fetch = fetchMock;

    await fetchWithRetry('https://example.test', {}, { retries: 2, timeoutMs: 1234 });
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(1234);
  });
});

describe('extractEmbeddedError', () => {
  it('detects OpenRouter error envelopes', () => {
    expect(
      extractEmbeddedError({
        type: 'error',
        error: { type: 'authentication_error', message: 'Invalid credentials' },
      }),
    ).toBe('Invalid credentials');
  });

  it('detects legacy { error: { message } } shape', () => {
    expect(extractEmbeddedError({ error: { code: 402, message: 'Insufficient credits' } })).toBe(
      'Insufficient credits',
    );
  });

  it('returns undefined for success payloads', () => {
    expect(extractEmbeddedError({ data: [{ id: 'x' }] })).toBeUndefined();
  });
});

describe('readJsonOrThrow', () => {
  it('throws on non-JSON bodies', async () => {
    const res = new Response('<html>bad</html>', { status: 200 });
    await expect(readJsonOrThrow(res, 'GET /models')).rejects.toThrow(/non-JSON response/);
  });

  it('throws on embedded error objects in 200 responses', async () => {
    const res = new Response(
      JSON.stringify({ type: 'error', error: { message: 'Invalid credentials' } }),
      { status: 200 },
    );
    await expect(readJsonOrThrow(res, 'GET /models')).rejects.toThrow(/Invalid credentials/);
  });
});

describe('OpenRouterAPIClient.getModels', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns empty array when data is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const client = new OpenRouterAPIClient('test-key');
    await expect(client.getModels()).resolves.toEqual([]);
  });

  it('throws on embedded error in a 200 models response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: 'error', error: { message: 'Invalid credentials' } }), {
        status: 200,
      }),
    );
    const client = new OpenRouterAPIClient('test-key');
    await expect(client.getModels()).rejects.toThrow(/Invalid credentials/);
  });
});

describe('readTranscriptionResponse', () => {
  const { readTranscriptionResponse } = _internals;

  it.each([
    ['text', 'plain transcript', 'text/plain'],
    ['srt', '1\n00:00:00,000 --> 00:00:01,000\nHi\n', 'text/plain'],
    ['vtt', 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n', 'text/vtt'],
  ] as const)('reads plain-text %s responses', async (format, body, contentType) => {
    const res = new Response(body, { status: 200, headers: { 'content-type': contentType } });
    await expect(
      readTranscriptionResponse(res, format, 'POST /audio/transcriptions'),
    ).resolves.toEqual({ text: body });
  });

  it('reads json transcription responses', async () => {
    const payload = { text: 'hello' };
    const res = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await expect(
      readTranscriptionResponse(res, 'json', 'POST /audio/transcriptions'),
    ).resolves.toEqual(payload);
  });

  it('reads verbose_json transcription responses', async () => {
    const payload = {
      text: 'hello',
      segments: [{ start: 0, end: 1, text: 'hello' }],
      language: 'en',
    };
    const res = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await expect(
      readTranscriptionResponse(res, 'verbose_json', 'POST /audio/transcriptions'),
    ).resolves.toEqual(payload);
  });
});

describe('OpenRouterAPIClient.transcribeAudio', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it.each([
    ['text', 'plain transcript', 'text/plain'],
    ['srt', '1\n00:00:00,000 --> 00:00:01,000\nHi\n', 'text/plain'],
    ['vtt', 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n', 'text/vtt'],
  ] as const)('returns plain text for response_format=%s', async (format, body, contentType) => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(body, { status: 200, headers: { 'content-type': contentType } }),
      );
    const client = new OpenRouterAPIClient('test-key');
    await expect(
      client.transcribeAudio({ model: 'openai/whisper-1', response_format: format }),
    ).resolves.toEqual({ text: body });
  });

  it('returns parsed JSON for response_format=json', async () => {
    const payload = { text: 'hello' };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new OpenRouterAPIClient('test-key');
    await expect(
      client.transcribeAudio({ model: 'openai/whisper-1', response_format: 'json' }),
    ).resolves.toEqual(payload);
  });

  it('returns parsed JSON for response_format=verbose_json', async () => {
    const payload = {
      text: 'hello',
      segments: [{ start: 0, end: 1, text: 'hello' }],
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new OpenRouterAPIClient('test-key');
    await expect(
      client.transcribeAudio({ model: 'openai/whisper-1', response_format: 'verbose_json' }),
    ).resolves.toEqual(payload);
  });
});
