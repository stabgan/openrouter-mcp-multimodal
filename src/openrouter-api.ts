import type { OpenRouterModelRecord } from './model-cache.js';

const BASE_URL = 'https://openrouter.ai/api/v1';

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 2): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) await sleep(400 * (attempt + 1));
        else return res;
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export class OpenRouterAPIClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getModels(): Promise<OpenRouterModelRecord[]> {
    const res = await fetchWithRetry(
      `${BASE_URL}/models`,
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(30000),
      },
      2,
    );
    if (!res.ok) throw new Error(`Failed to fetch models: HTTP ${res.status}`);
    const data = (await res.json()) as { data?: OpenRouterModelRecord[] };
    return data.data ?? [];
  }
}
