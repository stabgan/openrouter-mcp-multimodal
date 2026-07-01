/**
 * Regression suite — guards against reintroducing fixed bugs and schema drift.
 * Run via: npm run test:regression
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OpenAI from 'openai';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { TOOL_NAMES, TOOL_DESCRIPTIONS } from '../../tool-descriptions.js';
import { handleAnalyzeImage } from '../../tool-handlers/analyze-image.js';
import { handleAnalyzeAudio } from '../../tool-handlers/analyze-audio.js';
import { ModelCache } from '../../model-cache.js';

function mockOpenAI(): OpenAI {
  const create = vi.fn();
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

describe('regression: GHSA-3q7p-736f-x44v path sandbox on analyze_*', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'regression-sandbox-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('analyze_image rejects path outside input sandbox', async () => {
    const openai = mockOpenAI();
    const r = await handleAnalyzeImage(
      { params: { arguments: { image_path: '/etc/passwd', question: 'read' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UNSAFE_PATH');
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('analyze_audio rejects path outside input sandbox', async () => {
    const openai = mockOpenAI();
    const r = await handleAnalyzeAudio(
      { params: { arguments: { audio_path: '../../../etc/passwd', question: 'x' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UNSAFE_PATH');
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });
});

describe('regression: tool catalog completeness', () => {
  it('has exactly 14 tools with non-empty descriptions', () => {
    expect(TOOL_NAMES.length).toBe(14);
    for (const name of TOOL_NAMES) {
      expect(TOOL_DESCRIPTIONS[name].length).toBeGreaterThan(100);
    }
  });
});

describe('regression: model cache empty-fetch hot-loop (BUG)', () => {
  beforeEach(() => {
    ModelCache.getInstance().reset();
  });

  it('empty catalog still marks cache valid', () => {
    const cache = ModelCache.getInstance();
    cache.setModels([]);
    expect(cache.isValid()).toBe(true);
    expect(cache.size()).toBe(0);
  });
});

describe('regression: search_models pagination contract', () => {
  it('searchPaginated total stable across pages', () => {
    const cache = ModelCache.getInstance();
    cache.reset();
    cache.setModels(
      Array.from({ length: 25 }, (_, i) => ({
        id: `openai/model-${i}`,
        name: `Model ${i}`,
      })),
    );
    const p1 = cache.searchPaginated({ provider: 'openai' }, 0, 10);
    const p2 = cache.searchPaginated({ provider: 'openai' }, 10, 10);
    expect(p1.total).toBe(25);
    expect(p2.total).toBe(25);
    expect(p1.page).toHaveLength(10);
    expect(p2.page).toHaveLength(10);
    expect(p1.page[0].id).not.toBe(p2.page[0].id);
  });
});
