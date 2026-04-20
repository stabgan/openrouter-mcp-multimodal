import type { OpenRouterModelRecord } from './model-cache.js';

const BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const VIDEO_TIMEOUT_MS = 60_000;
const MAX_BACKOFF_MS = 10_000;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const asInt = parseInt(headerValue, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt * 1000;
  const asDate = Date.parse(headerValue);
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

function backoffWithJitter(attempt: number, retryAfterMs: number | null): number {
  const base = 400 * (attempt + 1);
  const target = Math.min(Math.max(base, retryAfterMs ?? 0), MAX_BACKOFF_MS);
  const jitter = 0.5 + Math.random(); // 0.5x .. 1.5x
  return Math.round(target * jitter);
}

/**
 * fetch() wrapper with retries on 429 / 5xx / network error.
 *
 * A fresh `AbortSignal.timeout(timeoutMs)` is created per attempt so retries
 * each get a full timeout budget. Backoff honors `Retry-After` (seconds or
 * HTTP-date) and applies jitter to avoid thundering-herd synchronization.
 */
async function fetchWithRetry(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  { retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS }: { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
          // Release the connection before retrying so undici/pool doesn't
          // keep it open while we sleep.
          try {
            await res.body?.cancel();
          } catch {
            /* ignore */
          }
          await sleep(backoffWithJitter(attempt, retryAfter));
          continue;
        }
        return res;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(backoffWithJitter(attempt, null));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export class OpenRouterAPIClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'HTTP-Referer': 'https://github.com/stabgan/openrouter-mcp-multimodal',
      'X-Title': 'openrouter-mcp-multimodal',
      ...extra,
    };
  }

  async getModels(): Promise<OpenRouterModelRecord[]> {
    const res = await fetchWithRetry(
      `${BASE_URL}/models`,
      { headers: this.authHeaders() },
      { retries: 2, timeoutMs: DEFAULT_TIMEOUT_MS },
    );
    if (!res.ok) throw new Error(`Failed to fetch models: HTTP ${res.status}`);
    const data = (await res.json()) as { data?: OpenRouterModelRecord[] };
    return data.data ?? [];
  }

  /** Submit a video-generation job. Returns the `{ id, polling_url, status }` envelope. */
  async submitVideoJob(body: Record<string, unknown>): Promise<VideoJobEnvelope> {
    const res = await fetchWithRetry(
      `${BASE_URL}/videos`,
      {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      },
      { retries: 2, timeoutMs: VIDEO_TIMEOUT_MS },
    );
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(`POST /videos failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    return (await res.json()) as VideoJobEnvelope;
  }

  /** Poll a submitted video-generation job by id. */
  async pollVideoJob(id: string): Promise<VideoJobStatus> {
    const res = await fetchWithRetry(
      `${BASE_URL}/videos/${encodeURIComponent(id)}`,
      { headers: this.authHeaders() },
      { retries: 2, timeoutMs: DEFAULT_TIMEOUT_MS },
    );
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(`GET /videos/${id} failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    return (await res.json()) as VideoJobStatus;
  }

  /**
   * Download the generated video binary. Returns `{ buffer, contentType }`.
   * This intentionally does NOT go through our SSRF-guarded `fetchHttpResource`
   * because the URL is always OpenRouter itself (trusted origin) — and it can
   * return arbitrarily large bodies that the caller bounds via
   * `OPENROUTER_VIDEO_MAX_DOWNLOAD_BYTES`.
   */
  async downloadVideoContent(
    id: string,
    index = 0,
    maxBytes = 256 * 1024 * 1024,
  ): Promise<{ buffer: Buffer; contentType: string | null }> {
    const url = `${BASE_URL}/videos/${encodeURIComponent(id)}/content?index=${index}`;
    const res = await fetchWithRetry(
      url,
      { headers: this.authHeaders() },
      { retries: 1, timeoutMs: VIDEO_TIMEOUT_MS * 2 },
    );
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(
        `GET /videos/${id}/content failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
      );
    }
    const declared = res.headers.get('content-length');
    if (declared) {
      const n = parseInt(declared, 10);
      if (Number.isFinite(n) && n > maxBytes) {
        throw new Error(`Generated video too large: ${n} bytes > ${maxBytes}`);
      }
    }
    const reader = res.body?.getReader();
    if (!reader) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new Error('Generated video too large');
      return { buffer: buf, contentType: res.headers.get('content-type') };
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new Error('Generated video too large');
      }
      chunks.push(Buffer.from(value));
    }
    return { buffer: Buffer.concat(chunks), contentType: res.headers.get('content-type') };
  }
}

export interface VideoJobEnvelope {
  id: string;
  status?: VideoJobStatusName;
  polling_url?: string;
  [key: string]: unknown;
}

export type VideoJobStatusName = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

export interface VideoJobStatus {
  id: string;
  status: VideoJobStatusName | string;
  unsigned_urls?: string[];
  error?: { message?: string; code?: string } | string;
  usage?: Record<string, unknown>;
  progress?: number;
  [key: string]: unknown;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.length > 500 ? t.slice(0, 500) + '…' : t;
  } catch {
    return '';
  }
}

// Exported for tests.
export const _internals = { parseRetryAfter, backoffWithJitter, fetchWithRetry };
