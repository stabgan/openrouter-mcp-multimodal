const BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterAPIClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getModels(): Promise<any[]> {
    const res = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Failed to fetch models: HTTP ${res.status}`);
    const data = await res.json() as any;
    return data.data ?? [];
  }
}
