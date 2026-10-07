import type { OpenRouterModelRecord } from './model-cache.js';
import { sanitizeErrorMessage } from './errors.js';

const BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const VIDEO_TIMEOUT_MS = 60_000;
const MAX_BACKOFF_MS = 10_000;
const SPEECH_MAX_BYTES = 50 * 1024 * 1024; // 50 MiB — generous for TTS output

/**
 * Ceiling for JSON and plain-text API responses. Binary downloads (video,
 * speech) already go through `readResponseBody` with their own limits;
 * this closes the gap for JSON endpoints (`/models`, `/videos`, `/images`,
 * `/audio/transcriptions`, `/rerank`) that previously read the full body
 * without a size guard, which could cause memory exhaustion from an
 * oversized upstream payload.
 */
const MAX_JSON_RESPONSE_BYTES = 50 * 1024 * 1024; // 50 MiB

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Read a Response body with a byte-count ceiling, streaming when available.
 * Checks Content-Length before reading and enforces the limit chunk-by-chunk.
 */
async function readResponseBody(res: Response, maxBytes: number, label: string): Promise<Buffer> {
  const declared = res.headers.get('content-length');
  if (declared) {
    const n = parseInt(declared, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      throw new Error(`${label} too large: ${n} bytes > ${maxBytes}`);
    }
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`${label} too large`);
    return buf;
  }
  // Collect raw Uint8Array chunks without copying each into a Buffer.
  // Buffer.concat accepts Uint8Array[], so only the final concat allocates.
  const chunks: Uint8Array[] = [];
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
      throw new Error(`${label} too large`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
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

async function fetchWithRetry(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  { retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS }: { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 408 || res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
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
    // Spread extra first so that non-negotiable headers (Authorization,
    // HTTP-Referer, X-Title) always win.  Current call sites only pass
    // cache headers and Content-Type, but this ordering prevents a future
    // code path from accidentally overriding the API key or identity.
    return {
      ...extra,
      Authorization: `Bearer ${this.apiKey}`,
      'HTTP-Referer': 'https://github.com/stabgan/openrouter-mcp-multimodal',
      'X-Title': 'openrouter-mcp-multimodal',
    };
  }

  async getModels(): Promise<OpenRouterModelRecord[]> {
    const res = await fetchWithRetry(
      `${BASE_URL}/models`,
      { headers: this.authHeaders() },
      { retries: 2, timeoutMs: DEFAULT_TIMEOUT_MS },
    );
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(`Failed to fetch models: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    const data = await readJsonOrThrow<{ data?: OpenRouterModelRecord[] }>(res, 'GET /models');
    return data.data ?? [];
  }

  /** Submit a video-generation job. */
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
    return readJsonOrThrow<VideoJobEnvelope>(res, 'POST /videos');
  }

  /** Poll a submitted video-generation job. */
  async pollVideoJob(id: string): Promise<VideoJobStatus> {
    const res = await fetchWithRetry(
      `${BASE_URL}/videos/${encodeURIComponent(id)}`,
      { headers: this.authHeaders() },
      { retries: 2, timeoutMs: DEFAULT_TIMEOUT_MS },
    );
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(
        `GET /videos/${id} failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
      );
    }
    // Skip embedded error extraction: job status responses legitimately
    // contain `error` fields for failed/cancelled jobs. extractEmbeddedError
    // would throw on those, hiding the structured status from callers.
    return readJsonOrThrow<VideoJobStatus>(res, `GET /videos/${id}`, {
      skipEmbeddedErrorCheck: true,
    });
  }

  /** Download generated video binary. */
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
    const buffer = await readResponseBody(res, maxBytes, 'Generated video');
    return { buffer, contentType: res.headers.get('content-type') };
  }

  /** POST /images. */
  async generateImage(
    body: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<ImageGenerationResponse> {
    const res = await fetchWithRetry(
      `${BASE_URL}/images`,
      {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json', ...headers }),
        body: JSON.stringify(body),
      },
      { retries: 2, timeoutMs: 120_000 },
    );
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(`POST /images failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    return readJsonOrThrow<ImageGenerationResponse>(res, 'POST /images');
  }

  /** POST /audio/speech. */
  async generateSpeech(
    body: Record<string, unknown>,
    headers?: Record<string, string>,
    maxBytes = SPEECH_MAX_BYTES,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const res = await fetchWithRetry(
      `${BASE_URL}/audio/speech`,
      {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json', ...headers }),
        body: JSON.stringify(body),
      },
      { retries: 2, timeoutMs: 60_000 },
    );
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(
        `POST /audio/speech failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
      );
    }
    const contentType = res.headers.get('content-type') || 'audio/mpeg';
    const buffer = await readResponseBody(res, maxBytes, 'Speech response');
    return { buffer, contentType };
  }

  /** POST /audio/transcriptions. */
  async transcribeAudio(
    body: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<TranscriptionResponse> {
    const res = await fetchWithRetry(
      `${BASE_URL}/audio/transcriptions`,
      {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json', ...headers }),
        body: JSON.stringify(body),
      },
      { retries: 2, timeoutMs: 60_000 },
    );
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(
        `POST /audio/transcriptions failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
      );
    }
    return readTranscriptionResponse(res, body.response_format, 'POST /audio/transcriptions');
  }

  /** POST /rerank. */
  async rerank(params: {
    model: string;
    query: string;
    documents: string[];
    top_n?: number;
    return_documents?: boolean;
  }): Promise<RerankResponse> {
    const body: Record<string, unknown> = {
      model: params.model,
      query: params.query,
      documents: params.documents,
    };
    if (typeof params.top_n === 'number' && params.top_n > 0) body.top_n = params.top_n;
    if (params.return_documents === true) body.return_documents = true;
    const res = await fetchWithRetry(
      `${BASE_URL}/rerank`,
      {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      },
      { retries: 2, timeoutMs: DEFAULT_TIMEOUT_MS },
    );
    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new Error(`POST /rerank failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    return readJsonOrThrow<RerankResponse>(res, 'POST /rerank');
  }
}

export interface VideoJobEnvelope {
  id: string;
  status?: VideoJobStatusName;
  polling_url?: string;
  [key: string]: unknown;
}

export interface ImageGenerationResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  usage?: { cost?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface TranscriptionResponse {
  text?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  language?: string;
  duration?: number;
  usage?: { cost?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface RerankResultItem {
  index: number;
  relevance_score?: number;
  score?: number;
  document?: { text?: string } | string;
}

export interface RerankResponse {
  model?: string;
  results: RerankResultItem[];
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export type VideoJobStatusName =
  'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'canceled';

export interface VideoJobStatus {
  id: string;
  status: VideoJobStatusName | string;
  unsigned_urls?: string[];
  error?: { message?: string; code?: string } | string;
  usage?: Record<string, unknown>;
  progress?: number;
  [key: string]: unknown;
}

/**
 * Byte cap for safeReadText. API error responses are typically well under
 * 4 KiB of JSON; capping here prevents memory exhaustion if a misbehaving
 * upstream sends an oversized body on a 4xx/5xx.
 */
const SAFE_READ_TEXT_MAX_BYTES = 4096;

async function safeReadText(res: Response): Promise<string> {
  try {
    const buffer = await readResponseBody(res, SAFE_READ_TEXT_MAX_BYTES, 'error detail');
    const t = buffer.toString('utf8');
    const trimmed = t.length > 500 ? t.slice(0, 500) + '…' : t;
    // Sanitize early: upstream error bodies may reflect the Authorization
    // header or API key material.  Downstream classifyUpstreamError also
    // sanitizes, but intermediate Error objects are logged by handlers
    // before reaching the classifier — scrub at the source.
    return sanitizeErrorMessage(trimmed);
  } catch {
    return '';
  }
}

function extractEmbeddedError(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as { error?: unknown; type?: string };
  if (record.type === 'error') {
    const err = record.error;
    if (typeof err === 'string') return err;
    if (
      err &&
      typeof err === 'object' &&
      typeof (err as { message?: string }).message === 'string'
    ) {
      return (err as { message: string }).message;
    }
  }
  if (record.error && typeof record.error === 'object') {
    const err = record.error as { message?: string; code?: number };
    if (typeof err.message === 'string') return err.message;
  }
  // Handle { error: "string" } without the type: 'error' wrapper — some
  // upstream endpoints use this minimal format for error responses.
  if (typeof record.error === 'string' && record.error.length > 0) {
    return record.error;
  }
  return undefined;
}

async function readTranscriptionResponse(
  res: Response,
  responseFormat: unknown,
  context: string,
): Promise<TranscriptionResponse> {
  const format = typeof responseFormat === 'string' ? responseFormat : 'json';
  const contentType = res.headers.get('content-type') ?? '';
  const plainByFormat = format === 'text' || format === 'srt' || format === 'vtt';
  const plainByContentType =
    contentType.startsWith('text/') && format !== 'json' && format !== 'verbose_json';

  if (plainByFormat || plainByContentType) {
    const buffer = await readResponseBody(res, MAX_JSON_RESPONSE_BYTES, `${context} text response`);
    return { text: buffer.toString('utf8') };
  }
  return readJsonOrThrow<TranscriptionResponse>(res, context);
}

async function readJsonOrThrow<T>(
  res: Response,
  context: string,
  opts?: { skipEmbeddedErrorCheck?: boolean },
): Promise<T> {
  const buffer = await readResponseBody(res, MAX_JSON_RESPONSE_BYTES, `${context} response`);
  const raw = buffer.toString('utf8');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    const snippet = raw.length > 500 ? raw.slice(0, 500) + '…' : raw;
    const detail = sanitizeErrorMessage(snippet);
    throw new Error(`${context}: non-JSON response${detail ? ` — ${detail}` : ''}`);
  }
  if (!opts?.skipEmbeddedErrorCheck) {
    const embedded = extractEmbeddedError(data);
    if (embedded) throw new Error(`${context}: ${embedded}`);
  }
  return data as T;
}

export const _internals = {
  parseRetryAfter,
  backoffWithJitter,
  fetchWithRetry,
  extractEmbeddedError,
  readJsonOrThrow,
  readTranscriptionResponse,
};
