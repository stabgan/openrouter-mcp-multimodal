export class ModelCache {
  private static instance: ModelCache;
  private models: Record<string, any> = {};
  private fetchedAt = 0;
  private ttl = 3600000; // 1 hour

  static getInstance(): ModelCache {
    return (ModelCache.instance ??= new ModelCache());
  }

  isValid(): boolean {
    return Object.keys(this.models).length > 0 && Date.now() - this.fetchedAt < this.ttl;
  }

  setModels(models: any[]): void {
    this.models = Object.fromEntries(models.map((m) => [m.id, m]));
    this.fetchedAt = Date.now();
  }

  getAll(): any[] {
    return Object.values(this.models);
  }

  get(id: string): any | null {
    return this.models[id] ?? null;
  }

  has(id: string): boolean {
    return id in this.models;
  }

  search(params: {
    query?: string;
    provider?: string;
    capabilities?: { vision?: boolean };
    limit?: number;
  }): any[] {
    let results = this.getAll();

    if (params.query) {
      const q = params.query.toLowerCase();
      results = results.filter((m) =>
        m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q),
      );
    }
    if (params.provider) {
      const p = params.provider.toLowerCase();
      results = results.filter((m) => m.id.toLowerCase().startsWith(p + '/'));
    }
    if (params.capabilities?.vision) {
      results = results.filter((m) =>
        m.architecture?.input_modalities?.includes('image'),
      );
    }

    return results.slice(0, params.limit ?? 10);
  }
}
