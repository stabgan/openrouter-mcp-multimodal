/**
 * Agent 2 — Coverage for MAX_MODEL_ID_LENGTH (256) validation across handlers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * The MAX_MODEL_ID_LENGTH (256) validation exists in four handlers but was
 * not exercised by any existing test file:
 *
 * embed_text.ts:
 *  1. model.length > 256 → INVALID_INPUT (checked BEFORE trim)
 *  2. model.length === 256 → accepted (boundary)
 *  3. model.length === 257 → rejected (boundary+1)
 *
 * decide.ts:
 *  4. model.length > 256 → INVALID_INPUT (checked BEFORE trim)
 *  5. model.length === 256 → accepted (boundary)
 *  6. model.length === 257 → rejected (boundary+1)
 *
 * get-model-info.ts:
 *  7. model.length > 256 → INVALID_INPUT (checked AFTER trim)
 *  8. model.length === 256 → accepted (boundary, after trim)
 *  9. model.length === 257 → rejected (boundary+1, after trim)
 *
 * validate-model.ts:
 *  10. model.length > 256 → INVALID_INPUT (checked AFTER trim)
 *  11. model.length === 256 → accepted (boundary, after trim)
 *  12. model.length === 257 → rejected (boundary+1, after trim)
 *
 * Additional edge cases:
 *  13. embed_text: model with leading/trailing spaces exceeding 256 total
 *       (fails because length check is pre-trim)
 *  14. get_model_info/validate_model: model with spaces that trims to ≤256
 *       (passes because length check is post-trim)
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { handleGetModelInfo } from '../tool-handlers/get-model-info.js';
import { handleValidateModel } from '../tool-handlers/validate-model.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  return {
    submitDecision: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQ(instructions = 'Is this true?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Yes', no: 'No' },
  };
}

// ---------------------------------------------------------------------------
// 1–3. embed_text — MAX_MODEL_ID_LENGTH (256) validation
// ---------------------------------------------------------------------------

describe('handleEmbedText — MAX_MODEL_ID_LENGTH (256)', () => {
  it('returns INVALID_INPUT when model exceeds 256 characters', async () => {
    const longModel = 'a'.repeat(300);
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: longModel }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('300');
  });

  it('returns INVALID_INPUT when model is exactly 257 characters', async () => {
    const model = 'x'.repeat(257);
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('257');
  });

  it('accepts model at exactly 256 characters', async () => {
    const model = 'openai/'.padEnd(256, 'z');
    expect(model.length).toBe(256);
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello', model }), client)) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect(client.createEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: model.trim() }),
    );
  });

  it('rejects model with spaces that totals > 256 chars (pre-trim check)', async () => {
    // embed_text checks model.length BEFORE trim — a 260-char string with
    // leading/trailing spaces still fails even if the trimmed version is shorter.
    const inner = 'a'.repeat(250);
    const model = `     ${inner}     `; // 260 chars total
    expect(model.length).toBe(260);
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('260');
  });
});

// ---------------------------------------------------------------------------
// 4–6. decide — MAX_MODEL_ID_LENGTH (256) validation
// ---------------------------------------------------------------------------

describe('handleDecide — MAX_MODEL_ID_LENGTH (256)', () => {
  it('returns INVALID_INPUT when model exceeds 256 characters', async () => {
    const longModel = 'b'.repeat(300);
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, model: longModel }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('300');
  });

  it('returns INVALID_INPUT when model is exactly 257 characters', async () => {
    const model = 'y'.repeat(257);
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, model }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('257');
  });

  it('accepts model at exactly 256 characters', async () => {
    const model = 'typesafe/'.padEnd(256, 'w');
    expect(model.length).toBe(256);
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, model }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect(client.submitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ model: model.trim() }),
    );
  });

  it('rejects model with spaces that totals > 256 chars (pre-trim check)', async () => {
    const longModel = `     ${'d'.repeat(256)}     `; // 266 chars
    expect(longModel.length).toBe(266);
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() }, model: longModel }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('266');
  });
});

// ---------------------------------------------------------------------------
// 7–9. get_model_info — MAX_MODEL_ID_LENGTH (256) validation (post-trim)
// ---------------------------------------------------------------------------

describe('handleGetModelInfo — MAX_MODEL_ID_LENGTH (256)', () => {
  let cache: ModelCache;

  beforeAll(() => {
    cache = ModelCache.getInstance();
    cache.setModels([{ id: 'openai/gpt-4o' }]);
  });

  it('returns INVALID_INPUT when model exceeds 256 chars after trim', async () => {
    const longModel = 'e'.repeat(257);
    const r = (await handleGetModelInfo(
      { params: { arguments: { model: longModel } } },
      cache,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('257');
  });

  it('returns INVALID_INPUT when model is 500 chars', async () => {
    const longModel = 'f'.repeat(500);
    const r = (await handleGetModelInfo(
      { params: { arguments: { model: longModel } } },
      cache,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('500');
  });

  it('processes model at exactly 256 chars after trim (boundary)', async () => {
    const model = 'g'.repeat(256);
    expect(model.length).toBe(256);
    // Model doesn't exist in cache → MODEL_NOT_FOUND, but it passes length validation
    const r = (await handleGetModelInfo(
      { params: { arguments: { model } } },
      cache,
    )) as ErrorResult;
    // Should be MODEL_NOT_FOUND (not INVALID_INPUT) — length check passed
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
  });

  it('passes length check when spaces trim model to ≤256 chars (post-trim)', async () => {
    // get_model_info trims BEFORE length check — 260 chars with spaces that
    // trim down to 250 chars should pass the length validation.
    const inner = 'h'.repeat(250);
    const model = `     ${inner}     `; // 260 chars total, 250 after trim
    expect(model.length).toBe(260);
    expect(model.trim().length).toBe(250);
    const r = (await handleGetModelInfo(
      { params: { arguments: { model } } },
      cache,
    )) as ErrorResult;
    // Should be MODEL_NOT_FOUND (not INVALID_INPUT) — length check on trimmed
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// 10–12. validate_model — MAX_MODEL_ID_LENGTH (256) validation (post-trim)
// ---------------------------------------------------------------------------

describe('handleValidateModel — MAX_MODEL_ID_LENGTH (256)', () => {
  let cache: ModelCache;

  beforeAll(() => {
    cache = ModelCache.getInstance();
    cache.setModels([{ id: 'openai/gpt-4o' }]);
  });

  it('returns INVALID_INPUT when model exceeds 256 chars after trim', async () => {
    const longModel = 'i'.repeat(257);
    const r = (await handleValidateModel(
      { params: { arguments: { model: longModel } } },
      cache,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('257');
  });

  it('returns INVALID_INPUT for 1000-char model', async () => {
    const longModel = 'j'.repeat(1000);
    const r = (await handleValidateModel(
      { params: { arguments: { model: longModel } } },
      cache,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('1000');
  });

  it('processes model at exactly 256 chars after trim (boundary)', async () => {
    const model = 'k'.repeat(256);
    expect(model.length).toBe(256);
    const r = await handleValidateModel({ params: { arguments: { model } } }, cache);
    // Length check passed → proceeds to lookup → valid: false (unknown model)
    const result = r as SuccessResult;
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent.valid).toBe(false);
    expect(result.structuredContent.model).toBe(model);
  });

  it('passes length check when spaces trim model to ≤256 chars (post-trim)', async () => {
    const inner = 'l'.repeat(250);
    const model = `     ${inner}     `; // 260 chars total, 250 after trim
    expect(model.length).toBe(260);
    expect(model.trim().length).toBe(250);
    const r = await handleValidateModel({ params: { arguments: { model } } }, cache);
    // Length check on trimmed value → passes → valid: false
    const result = r as SuccessResult;
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent.valid).toBe(false);
  });
});
