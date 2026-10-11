/**
 * Agent 6 — Round 2: Test coverage for untested handler branches.
 *
 * Targets:
 * - handleValidateModel: all validation + cache branches
 * - handleGetModelInfo: all validation + cache + model-not-found
 * - chat-request.ts validators: validateTemperature, validateStop, validateTopP,
 *   validatePenalty, validateLogprobs, validateSeed, validateResponseFormat,
 *   validateWebSearchOptions, validateReasoningEffort
 * - buildChatCompletionBody: stop, top_p, frequency_penalty, presence_penalty,
 *   logprobs, top_logprobs, seed, reasoning_effort, response_format (json_object/json_schema),
 *   fusion, subagent (bool + object), response_healing, web_blocked_domains
 * - readToolPayload: structuredContent vs text fallback
 * - handleHealthCheck: outer catch (buildStructuredResult crash path)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleValidateModel } from '../tool-handlers/validate-model.js';
import { handleGetModelInfo } from '../tool-handlers/get-model-info.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode } from '../errors.js';
import {
  validateTemperature,
  validateStop,
  validateTopP,
  validatePenalty,
  validateLogprobs,
  validateSeed,
  validateResponseFormat,
  validateWebSearchOptions,
  validateReasoningEffort,
  buildChatCompletionBody,
} from '../tool-handlers/chat-request.js';
import { readToolPayload, buildStructuredResult } from '../tool-handlers/structured-output.js';
import { buildBinaryToolResult, getMaxInlineBytes } from '../tool-handlers/tool-result-payload.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetCache(): ModelCache {
  const cache = ModelCache.getInstance();
  cache.reset();
  return cache;
}

function seedCache(cache: ModelCache): void {
  cache.setModels([
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet' },
  ]);
}

function mockApiClient(models?: unknown[], throws?: Error): OpenRouterAPIClient {
  const getModels = vi.fn();
  if (throws) getModels.mockRejectedValue(throws);
  else getModels.mockResolvedValue(models ?? [{ id: 'openai/gpt-4o' }]);
  return { getModels } as unknown as OpenRouterAPIClient;
}

// ---------------------------------------------------------------------------
// handleValidateModel
// ---------------------------------------------------------------------------
describe('handleValidateModel', () => {
  beforeEach(() => resetCache());

  it('returns INVALID_INPUT when model is a number', async () => {
    const cache = resetCache();
    const r = await handleValidateModel(
      { params: { arguments: { model: 42 as unknown as string } } },
      cache,
    );
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('string');
  });

  it('returns INVALID_INPUT when model is a boolean', async () => {
    const cache = resetCache();
    const r = await handleValidateModel(
      { params: { arguments: { model: true as unknown as string } } },
      cache,
    );
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when model is empty string', async () => {
    const cache = resetCache();
    const r = await handleValidateModel({ params: { arguments: { model: '' } } }, cache);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('required');
  });

  it('returns INVALID_INPUT when model is whitespace-only', async () => {
    const cache = resetCache();
    const r = await handleValidateModel({ params: { arguments: { model: '   ' } } }, cache);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns valid=true when model exists in cache', async () => {
    const cache = resetCache();
    seedCache(cache);
    const r = await handleValidateModel(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    expect(r.isError).toBeFalsy();
    const sc = (r as { structuredContent: { valid: boolean; model: string } }).structuredContent;
    expect(sc.valid).toBe(true);
    expect(sc.model).toBe('openai/gpt-4o');
  });

  it('returns valid=false when model does not exist in cache', async () => {
    const cache = resetCache();
    seedCache(cache);
    const r = await handleValidateModel(
      { params: { arguments: { model: 'nonexistent/model' } } },
      cache,
    );
    expect(r.isError).toBeFalsy();
    const sc = (r as { structuredContent: { valid: boolean } }).structuredContent;
    expect(sc.valid).toBe(false);
  });

  it('refreshes cache via apiClient when provided', async () => {
    const cache = resetCache();
    const api = mockApiClient([{ id: 'openai/gpt-4o' }, { id: 'meta/llama-3' }]);
    const r = await handleValidateModel(
      { params: { arguments: { model: 'meta/llama-3' } } },
      cache,
      api,
    );
    expect(api.getModels).toHaveBeenCalled();
    const sc = (r as { structuredContent: { valid: boolean } }).structuredContent;
    expect(sc.valid).toBe(true);
  });

  it('classifies upstream error when cache refresh fails', async () => {
    const cache = resetCache();
    const api = mockApiClient(undefined, new Error('HTTP 401'));
    const r = await handleValidateModel(
      { params: { arguments: { model: 'any/model' } } },
      cache,
      api,
    );
    expect(r.isError).toBe(true);
  });

  it('returns INTERNAL when no model data available and no apiClient', async () => {
    const cache = resetCache();
    const r = await handleValidateModel(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INTERNAL);
    expect(r.content[0].text).toContain('No model data');
  });

  it('trims whitespace from model input', async () => {
    const cache = resetCache();
    seedCache(cache);
    const r = await handleValidateModel(
      { params: { arguments: { model: '  openai/gpt-4o  ' } } },
      cache,
    );
    const sc = (r as { structuredContent: { valid: boolean } }).structuredContent;
    expect(sc.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleGetModelInfo
// ---------------------------------------------------------------------------
describe('handleGetModelInfo', () => {
  beforeEach(() => resetCache());

  it('returns INVALID_INPUT when model is a number', async () => {
    const cache = resetCache();
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 123 as unknown as string } } },
      cache,
    );
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when model is empty', async () => {
    const cache = resetCache();
    const r = await handleGetModelInfo({ params: { arguments: { model: '' } } }, cache);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('required');
  });

  it('returns INVALID_INPUT when model is whitespace-only', async () => {
    const cache = resetCache();
    const r = await handleGetModelInfo({ params: { arguments: { model: '   ' } } }, cache);
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns model info when model exists', async () => {
    const cache = resetCache();
    seedCache(cache);
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    expect(r.isError).toBeFalsy();
    const sc = (r as { structuredContent: { id: string } }).structuredContent;
    expect(sc.id).toBe('openai/gpt-4o');
  });

  it('returns MODEL_NOT_FOUND when model does not exist', async () => {
    const cache = resetCache();
    seedCache(cache);
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'nonexistent/model' } } },
      cache,
    );
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.MODEL_NOT_FOUND);
    expect(r.content[0].text).toContain('nonexistent/model');
    expect(r._meta.suggestions).toBeDefined();
    expect((r._meta.suggestions as string[]).some((s) => /search_models/.test(s))).toBe(true);
  });

  it('refreshes cache via apiClient when provided', async () => {
    const cache = resetCache();
    const api = mockApiClient([{ id: 'openai/gpt-4o', name: 'GPT-4o' }]);
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
      api,
    );
    expect(api.getModels).toHaveBeenCalled();
    expect(r.isError).toBeFalsy();
  });

  it('classifies upstream error when cache refresh fails', async () => {
    const cache = resetCache();
    const api = mockApiClient(undefined, new Error('HTTP 500'));
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'any/model' } } },
      cache,
      api,
    );
    expect(r.isError).toBe(true);
  });

  it('returns INTERNAL when no model data available and no apiClient', async () => {
    const cache = resetCache();
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INTERNAL);
  });

  it('trims whitespace from model input', async () => {
    const cache = resetCache();
    seedCache(cache);
    const r = await handleGetModelInfo(
      { params: { arguments: { model: '  openai/gpt-4o  ' } } },
      cache,
    );
    expect(r.isError).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// validateTemperature
// ---------------------------------------------------------------------------
describe('validateTemperature', () => {
  it('returns null for undefined', () => {
    expect(validateTemperature(undefined)).toBeNull();
  });

  it('returns null for valid temperature 0', () => {
    expect(validateTemperature(0)).toBeNull();
  });

  it('returns null for valid temperature 2', () => {
    expect(validateTemperature(2)).toBeNull();
  });

  it('returns null for valid temperature 0.7', () => {
    expect(validateTemperature(0.7)).toBeNull();
  });

  it('rejects temperature below 0', () => {
    const r = validateTemperature(-0.1);
    expect(r?.isError).toBe(true);
    expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('rejects temperature above 2', () => {
    const r = validateTemperature(2.1);
    expect(r?.isError).toBe(true);
    expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('rejects NaN temperature', () => {
    const r = validateTemperature(NaN);
    expect(r?.isError).toBe(true);
  });

  it('rejects Infinity temperature', () => {
    const r = validateTemperature(Infinity);
    expect(r?.isError).toBe(true);
  });

  it('rejects non-number temperature', () => {
    const r = validateTemperature('hot' as unknown as number);
    expect(r?.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateStop
// ---------------------------------------------------------------------------
describe('validateStop', () => {
  it('returns null for undefined', () => {
    expect(validateStop(undefined)).toBeNull();
  });

  it('returns null for a valid string', () => {
    expect(validateStop('\n')).toBeNull();
  });

  it('rejects empty string', () => {
    const r = validateStop('');
    expect(r?.isError).toBe(true);
    expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns null for valid array of 1-4 strings', () => {
    expect(validateStop(['\n'])).toBeNull();
    expect(validateStop(['\n', '###', 'END', 'STOP'])).toBeNull();
  });

  it('rejects empty array', () => {
    const r = validateStop([]);
    expect(r?.isError).toBe(true);
    expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('rejects array with more than 4 elements', () => {
    const r = validateStop(['a', 'b', 'c', 'd', 'e']);
    expect(r?.isError).toBe(true);
    expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('rejects array with empty string entry', () => {
    const r = validateStop(['ok', '']);
    expect(r?.isError).toBe(true);
    expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r?.content[0].text).toContain('stop[1]');
  });

  it('rejects array with non-string entry', () => {
    const r = validateStop(['ok', 42 as unknown as string]);
    expect(r?.isError).toBe(true);
  });

  it('rejects non-string non-array value', () => {
    const r = validateStop(42 as unknown as string);
    expect(r?.isError).toBe(true);
    expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });
});

// ---------------------------------------------------------------------------
// validateTopP
// ---------------------------------------------------------------------------
describe('validateTopP', () => {
  it('returns null for undefined', () => {
    expect(validateTopP(undefined)).toBeNull();
  });

  it('returns null for 0', () => {
    expect(validateTopP(0)).toBeNull();
  });

  it('returns null for 1', () => {
    expect(validateTopP(1)).toBeNull();
  });

  it('rejects value below 0', () => {
    expect(validateTopP(-0.1)?.isError).toBe(true);
  });

  it('rejects value above 1', () => {
    expect(validateTopP(1.1)?.isError).toBe(true);
  });

  it('rejects NaN', () => {
    expect(validateTopP(NaN)?.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validatePenalty
// ---------------------------------------------------------------------------
describe('validatePenalty', () => {
  it('returns null for undefined', () => {
    expect(validatePenalty(undefined, 'frequency_penalty')).toBeNull();
  });

  it('returns null for -2', () => {
    expect(validatePenalty(-2, 'frequency_penalty')).toBeNull();
  });

  it('returns null for 2', () => {
    expect(validatePenalty(2, 'presence_penalty')).toBeNull();
  });

  it('returns null for 0', () => {
    expect(validatePenalty(0, 'frequency_penalty')).toBeNull();
  });

  it('rejects value below -2', () => {
    const r = validatePenalty(-2.1, 'frequency_penalty');
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('frequency_penalty');
  });

  it('rejects value above 2', () => {
    const r = validatePenalty(2.1, 'presence_penalty');
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('presence_penalty');
  });

  it('rejects NaN', () => {
    expect(validatePenalty(NaN, 'frequency_penalty')?.isError).toBe(true);
  });

  it('rejects non-number', () => {
    expect(validatePenalty('high' as unknown as number, 'test')?.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateLogprobs
// ---------------------------------------------------------------------------
describe('validateLogprobs', () => {
  it('returns null when both undefined', () => {
    expect(validateLogprobs(undefined, undefined)).toBeNull();
  });

  it('returns null for logprobs=true without top_logprobs', () => {
    expect(validateLogprobs(true, undefined)).toBeNull();
  });

  it('returns null for logprobs=true with valid top_logprobs', () => {
    expect(validateLogprobs(true, 5)).toBeNull();
  });

  it('returns null for logprobs=true with top_logprobs=0', () => {
    expect(validateLogprobs(true, 0)).toBeNull();
  });

  it('returns null for logprobs=true with top_logprobs=20', () => {
    expect(validateLogprobs(true, 20)).toBeNull();
  });

  it('rejects non-boolean logprobs', () => {
    const r = validateLogprobs('yes' as unknown as boolean, undefined);
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('logprobs');
  });

  it('rejects top_logprobs without logprobs=true', () => {
    const r = validateLogprobs(false, 5);
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('logprobs: true');
  });

  it('rejects top_logprobs without logprobs set', () => {
    const r = validateLogprobs(undefined, 5);
    expect(r?.isError).toBe(true);
  });

  it('rejects top_logprobs above 20', () => {
    const r = validateLogprobs(true, 21);
    expect(r?.isError).toBe(true);
  });

  it('rejects negative top_logprobs', () => {
    const r = validateLogprobs(true, -1);
    expect(r?.isError).toBe(true);
  });

  it('rejects non-integer top_logprobs', () => {
    const r = validateLogprobs(true, 1.5);
    expect(r?.isError).toBe(true);
  });

  it('rejects NaN top_logprobs', () => {
    const r = validateLogprobs(true, NaN);
    expect(r?.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSeed
// ---------------------------------------------------------------------------
describe('validateSeed', () => {
  it('returns null for undefined', () => {
    expect(validateSeed(undefined)).toBeNull();
  });

  it('returns null for integer 0', () => {
    expect(validateSeed(0)).toBeNull();
  });

  it('returns null for positive integer', () => {
    expect(validateSeed(42)).toBeNull();
  });

  it('returns null for negative integer', () => {
    expect(validateSeed(-1)).toBeNull();
  });

  it('rejects float', () => {
    expect(validateSeed(1.5)?.isError).toBe(true);
  });

  it('rejects NaN', () => {
    expect(validateSeed(NaN)?.isError).toBe(true);
  });

  it('rejects Infinity', () => {
    expect(validateSeed(Infinity)?.isError).toBe(true);
  });

  it('rejects non-number', () => {
    expect(validateSeed('abc' as unknown as number)?.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateReasoningEffort
// ---------------------------------------------------------------------------
describe('validateReasoningEffort', () => {
  it('returns null for undefined', () => {
    expect(validateReasoningEffort(undefined)).toBeNull();
  });

  it('returns null for valid string "high"', () => {
    expect(validateReasoningEffort('high')).toBeNull();
  });

  it('returns null for valid string "low"', () => {
    expect(validateReasoningEffort('low')).toBeNull();
  });

  it('returns null for any non-empty string (free-form)', () => {
    expect(validateReasoningEffort('custom_effort')).toBeNull();
  });

  it('rejects empty string', () => {
    const r = validateReasoningEffort('');
    expect(r?.isError).toBe(true);
    expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('rejects whitespace-only string', () => {
    const r = validateReasoningEffort('   ');
    expect(r?.isError).toBe(true);
  });

  it('rejects non-string', () => {
    const r = validateReasoningEffort(42 as unknown as string);
    expect(r?.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateResponseFormat
// ---------------------------------------------------------------------------
describe('validateResponseFormat', () => {
  it('returns null for undefined', () => {
    expect(validateResponseFormat(undefined)).toBeNull();
  });

  it('returns null for { type: "text" }', () => {
    expect(validateResponseFormat({ type: 'text' })).toBeNull();
  });

  it('returns null for { type: "json_object" }', () => {
    expect(validateResponseFormat({ type: 'json_object' })).toBeNull();
  });

  it('returns null for valid json_schema format', () => {
    expect(
      validateResponseFormat({
        type: 'json_schema',
        json_schema: { name: 'Test', schema: { type: 'object' } },
      }),
    ).toBeNull();
  });

  it('rejects non-object', () => {
    const r = validateResponseFormat('json' as unknown as { type: string });
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('response_format');
  });

  it('rejects null', () => {
    const r = validateResponseFormat(null as unknown as { type: string });
    expect(r?.isError).toBe(true);
  });

  it('rejects array', () => {
    const r = validateResponseFormat([] as unknown as { type: string });
    expect(r?.isError).toBe(true);
  });

  it('rejects missing type', () => {
    const r = validateResponseFormat({} as { type: string });
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('type');
  });

  it('rejects empty type string', () => {
    const r = validateResponseFormat({ type: '' });
    expect(r?.isError).toBe(true);
  });

  it('rejects unsupported type', () => {
    const r = validateResponseFormat({ type: 'xml' });
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('xml');
  });

  it('rejects json_schema without json_schema field', () => {
    const r = validateResponseFormat({ type: 'json_schema' });
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('json_schema');
  });

  it('rejects json_schema with array as schema', () => {
    const r = validateResponseFormat({ type: 'json_schema', json_schema: [] });
    expect(r?.isError).toBe(true);
  });

  it('rejects json_schema with missing name', () => {
    const r = validateResponseFormat({
      type: 'json_schema',
      json_schema: { schema: { type: 'object' } },
    });
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('name');
  });

  it('rejects json_schema with empty name', () => {
    const r = validateResponseFormat({
      type: 'json_schema',
      json_schema: { name: '  ', schema: { type: 'object' } },
    });
    expect(r?.isError).toBe(true);
  });

  it('rejects json_schema with non-object schema', () => {
    const r = validateResponseFormat({
      type: 'json_schema',
      json_schema: { name: 'Test', schema: 'not-an-object' },
    });
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('schema');
  });
});

// ---------------------------------------------------------------------------
// validateWebSearchOptions
// ---------------------------------------------------------------------------
describe('validateWebSearchOptions', () => {
  it('returns null when all undefined', () => {
    expect(validateWebSearchOptions(undefined, undefined)).toBeNull();
  });

  it('returns null for valid web_max_results with online=true', () => {
    expect(validateWebSearchOptions(5, undefined, true)).toBeNull();
  });

  it('rejects non-integer web_max_results', () => {
    const r = validateWebSearchOptions(1.5, undefined, true);
    expect(r?.isError).toBe(true);
  });

  it('rejects zero web_max_results', () => {
    const r = validateWebSearchOptions(0, undefined, true);
    expect(r?.isError).toBe(true);
  });

  it('rejects negative web_max_results', () => {
    const r = validateWebSearchOptions(-1, undefined, true);
    expect(r?.isError).toBe(true);
  });

  it('rejects NaN web_max_results', () => {
    const r = validateWebSearchOptions(NaN, undefined, true);
    expect(r?.isError).toBe(true);
  });

  it('rejects non-number web_max_results', () => {
    const r = validateWebSearchOptions('five' as unknown as number, undefined, true);
    expect(r?.isError).toBe(true);
  });

  it('rejects non-array web_blocked_domains', () => {
    const r = validateWebSearchOptions(undefined, 'example.com' as unknown as string[], true);
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('web_blocked_domains');
  });

  it('rejects web_blocked_domains with empty string entry', () => {
    const r = validateWebSearchOptions(undefined, ['example.com', ''], true);
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('web_blocked_domains[1]');
  });

  it('rejects web_blocked_domains with non-string entry', () => {
    const r = validateWebSearchOptions(undefined, [42 as unknown as string], true);
    expect(r?.isError).toBe(true);
  });

  it('rejects web params without online=true', () => {
    const r = validateWebSearchOptions(5, undefined, false);
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('online: true');
  });

  it('rejects web_blocked_domains without online=true', () => {
    const r = validateWebSearchOptions(undefined, ['example.com'], false);
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('online: true');
  });

  it('passes with empty web_blocked_domains without online', () => {
    expect(validateWebSearchOptions(undefined, [], false)).toBeNull();
  });

  it('passes valid web_blocked_domains with online=true', () => {
    expect(validateWebSearchOptions(undefined, ['example.com', 'test.org'], true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildChatCompletionBody — new param coverage
// ---------------------------------------------------------------------------
describe('buildChatCompletionBody — extended params', () => {
  afterEach(() => vi.unstubAllEnvs());

  const base = {
    model: 'test/model',
    messages: [{ role: 'user' as const, content: 'hi' }],
  };

  it('includes stop as string', () => {
    const body = buildChatCompletionBody({ ...base, stop: '\n' });
    expect(body.stop).toBe('\n');
  });

  it('includes stop as array', () => {
    const body = buildChatCompletionBody({ ...base, stop: ['\n', '###'] });
    expect(body.stop).toEqual(['\n', '###']);
  });

  it('omits stop when undefined', () => {
    const body = buildChatCompletionBody(base);
    expect(body).not.toHaveProperty('stop');
  });

  it('includes top_p', () => {
    const body = buildChatCompletionBody({ ...base, top_p: 0.9 });
    expect(body.top_p).toBe(0.9);
  });

  it('omits top_p when undefined', () => {
    expect(buildChatCompletionBody(base)).not.toHaveProperty('top_p');
  });

  it('includes frequency_penalty', () => {
    const body = buildChatCompletionBody({ ...base, frequency_penalty: 0.5 });
    expect(body.frequency_penalty).toBe(0.5);
  });

  it('includes presence_penalty', () => {
    const body = buildChatCompletionBody({ ...base, presence_penalty: -1.0 });
    expect(body.presence_penalty).toBe(-1.0);
  });

  it('includes logprobs=true', () => {
    const body = buildChatCompletionBody({ ...base, logprobs: true });
    expect(body.logprobs).toBe(true);
  });

  it('omits logprobs when false', () => {
    const body = buildChatCompletionBody({ ...base, logprobs: false });
    expect(body).not.toHaveProperty('logprobs');
  });

  it('includes top_logprobs', () => {
    const body = buildChatCompletionBody({ ...base, logprobs: true, top_logprobs: 5 });
    expect(body.top_logprobs).toBe(5);
  });

  it('includes seed', () => {
    const body = buildChatCompletionBody({ ...base, seed: 42 });
    expect(body.seed).toBe(42);
  });

  it('omits seed when undefined', () => {
    expect(buildChatCompletionBody(base)).not.toHaveProperty('seed');
  });

  it('includes reasoning_effort when non-empty', () => {
    const body = buildChatCompletionBody({ ...base, reasoning_effort: 'high' });
    expect(body.reasoning_effort).toBe('high');
  });

  it('trims reasoning_effort', () => {
    const body = buildChatCompletionBody({ ...base, reasoning_effort: '  medium  ' });
    expect(body.reasoning_effort).toBe('medium');
  });

  it('omits reasoning_effort when empty after trim', () => {
    const body = buildChatCompletionBody({ ...base, reasoning_effort: '   ' });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('includes response_format for json_object', () => {
    const body = buildChatCompletionBody({
      ...base,
      response_format: { type: 'json_object' },
    });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('includes response_format for json_schema', () => {
    const rf = {
      type: 'json_schema',
      json_schema: { name: 'Test', schema: { type: 'object' } },
    };
    const body = buildChatCompletionBody({ ...base, response_format: rf });
    expect(body.response_format).toEqual(rf);
  });

  it('omits response_format when type is "text"', () => {
    const body = buildChatCompletionBody({
      ...base,
      response_format: { type: 'text' },
    });
    expect(body).not.toHaveProperty('response_format');
  });

  it('adds fusion tool when fusion=true', () => {
    const body = buildChatCompletionBody({ ...base, fusion: true });
    expect(body.tools).toEqual([{ type: 'openrouter:fusion' }]);
  });

  it('adds subagent tool when subagent=true (boolean)', () => {
    const body = buildChatCompletionBody({ ...base, subagent: true });
    expect(body.tools).toEqual([{ type: 'openrouter:subagent' }]);
  });

  it('adds subagent tool with model when subagent is object', () => {
    const body = buildChatCompletionBody({
      ...base,
      subagent: { model: 'openai/gpt-4o-mini' },
    });
    expect(body.tools).toEqual([
      { type: 'openrouter:subagent', parameters: { model: 'openai/gpt-4o-mini' } },
    ]);
  });

  it('combines fusion and subagent tools', () => {
    const body = buildChatCompletionBody({ ...base, fusion: true, subagent: true });
    const tools = body.tools as Array<{ type: string }>;
    expect(tools).toHaveLength(2);
    expect(tools.some((t) => t.type === 'openrouter:fusion')).toBe(true);
    expect(tools.some((t) => t.type === 'openrouter:subagent')).toBe(true);
  });

  it('adds response_healing as plugin', () => {
    const body = buildChatCompletionBody({ ...base, response_healing: true });
    expect(body.plugins).toEqual([{ id: 'response_healing' }]);
  });

  it('combines web plugin and response_healing', () => {
    const body = buildChatCompletionBody({
      ...base,
      online: true,
      response_healing: true,
    });
    const plugins = body.plugins as Array<{ id: string }>;
    expect(plugins).toHaveLength(2);
    expect(plugins.some((p) => p.id === 'web')).toBe(true);
    expect(plugins.some((p) => p.id === 'response_healing')).toBe(true);
  });

  it('adds web_blocked_domains to web plugin', () => {
    const body = buildChatCompletionBody({
      ...base,
      online: true,
      web_blocked_domains: ['example.com', 'spam.org'],
    });
    expect(body.plugins).toEqual([
      { id: 'web', blocked_domains: ['example.com', 'spam.org'] },
    ]);
  });

  it('omits tools key when none enabled', () => {
    const body = buildChatCompletionBody(base);
    expect(body).not.toHaveProperty('tools');
  });

  it('omits plugins key when none enabled', () => {
    const body = buildChatCompletionBody(base);
    expect(body).not.toHaveProperty('plugins');
  });
});

// ---------------------------------------------------------------------------
// readToolPayload
// ---------------------------------------------------------------------------
describe('readToolPayload', () => {
  it('reads from structuredContent when present', () => {
    const r = readToolPayload({ structuredContent: { ok: true } });
    expect(r).toEqual({ ok: true });
  });

  it('falls back to parsing content text when no structuredContent', () => {
    const r = readToolPayload({
      content: [{ type: 'text', text: '{"ok":true}' }],
    });
    expect(r).toEqual({ ok: true });
  });

  it('throws when neither structuredContent nor content text exist', () => {
    expect(() => readToolPayload({ content: [] })).toThrow('no structuredContent');
  });

  it('throws when content text is absent', () => {
    expect(() => readToolPayload({})).toThrow('no structuredContent');
  });

  it('throws on invalid JSON in content text', () => {
    expect(() =>
      readToolPayload({ content: [{ type: 'text', text: 'not json' }] }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildStructuredResult
// ---------------------------------------------------------------------------
describe('buildStructuredResult', () => {
  it('includes server_version in meta', () => {
    const r = buildStructuredResult({ foo: 'bar' });
    expect(r._meta.server_version).toBeDefined();
  });

  it('merges custom meta', () => {
    const r = buildStructuredResult({ foo: 'bar' }, { custom: 'value' });
    expect(r._meta.custom).toBe('value');
  });

  it('provides JSON text in content', () => {
    const r = buildStructuredResult({ x: 1 });
    expect(r.content[0].text).toBe(JSON.stringify({ x: 1 }, null, 2));
  });

  it('preserves data in structuredContent', () => {
    const r = buildStructuredResult({ list: [1, 2, 3] });
    expect(r.structuredContent).toEqual({ list: [1, 2, 3] });
  });
});

// ---------------------------------------------------------------------------
// buildBinaryToolResult — edge cases
// ---------------------------------------------------------------------------
describe('buildBinaryToolResult edge cases', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns text-only when buffer exceeds inline max', () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 0x42);
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: big, mimeType: 'image/png' },
      { maxInlineBytes: 1024 },
    );
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
    expect((r.content[0] as { text: string }).text).toContain('Too large to inline');
  });

  it('includes remote URL hint when too large', () => {
    const big = Buffer.alloc(2048, 0x42);
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: big, mimeType: 'image/png' },
      { maxInlineBytes: 1024, remoteUrl: 'https://example.com/img.png' },
    );
    expect((r.content[0] as { text: string }).text).toContain('https://example.com/img.png');
  });

  it('uses text-only with savedPath even when buffer is small', () => {
    const small = Buffer.from('tiny');
    const r = buildBinaryToolResult(
      { kind: 'audio', buffer: small, mimeType: 'audio/mpeg' },
      { savedPath: '/tmp/out.mp3' },
    );
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
    expect(r._meta.save_path).toBe('/tmp/out.mp3');
  });

  it('uses custom summaryText for saved path', () => {
    const r = buildBinaryToolResult(
      { kind: 'audio', buffer: Buffer.from('x'), mimeType: 'audio/wav' },
      { savedPath: '/tmp/x.wav', summaryText: 'Custom save message' },
    );
    expect((r.content[0] as { text: string }).text).toBe('Custom save message');
  });

  it('inlines media when buffer fits and no save_path', () => {
    const small = Buffer.from('data');
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: small, mimeType: 'image/png' },
      { maxInlineBytes: 1024 },
    );
    expect(r.content).toHaveLength(2);
    expect(r.content[0].type).toBe('text');
    expect(r.content[1].type).toBe('image');
  });

  it('uses inlineOnly mode (no text prefix)', () => {
    const small = Buffer.from('px');
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: small, mimeType: 'image/png' },
      { maxInlineBytes: 1024, inlineOnly: true },
    );
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('image');
  });

  it('uses resource type for video kind', () => {
    const small = Buffer.from('video');
    const r = buildBinaryToolResult(
      { kind: 'video', buffer: small, mimeType: 'video/mp4' },
      { maxInlineBytes: 1024 },
    );
    const mediaBlock = r.content[1];
    expect(mediaBlock.type).toBe('resource');
  });

  it('uses preEncodedBase64 when provided', () => {
    const buf = Buffer.from('test');
    const preEncoded = 'cHJlZW5jb2RlZA==';
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: buf, mimeType: 'image/png' },
      { maxInlineBytes: 1024, inlineOnly: true, preEncodedBase64: preEncoded },
    );
    const imgBlock = r.content[0] as { data: string };
    expect(imgBlock.data).toBe(preEncoded);
  });
});

// ---------------------------------------------------------------------------
// getMaxInlineBytes
// ---------------------------------------------------------------------------
describe('getMaxInlineBytes', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns default for image when no env set', () => {
    const r = getMaxInlineBytes('image');
    expect(r).toBe(1024 * 1024);
  });

  it('returns default for video when no env set', () => {
    const r = getMaxInlineBytes('video');
    expect(r).toBe(10 * 1024 * 1024);
  });

  it('respects kind-specific env var', () => {
    vi.stubEnv('OPENROUTER_IMAGE_INLINE_MAX_BYTES', '2048');
    expect(getMaxInlineBytes('image')).toBe(2048);
  });

  it('falls back to global env var', () => {
    vi.stubEnv('OPENROUTER_INLINE_MAX_BYTES', '4096');
    expect(getMaxInlineBytes('audio')).toBe(4096);
  });

  it('kind-specific env overrides global', () => {
    vi.stubEnv('OPENROUTER_INLINE_MAX_BYTES', '4096');
    vi.stubEnv('OPENROUTER_IMAGE_INLINE_MAX_BYTES', '512');
    expect(getMaxInlineBytes('image')).toBe(512);
  });

  it('ignores non-numeric env values', () => {
    vi.stubEnv('OPENROUTER_IMAGE_INLINE_MAX_BYTES', 'not-a-number');
    const r = getMaxInlineBytes('image');
    expect(r).toBe(1024 * 1024);
  });

  it('allows 0 as a valid env value', () => {
    vi.stubEnv('OPENROUTER_IMAGE_INLINE_MAX_BYTES', '0');
    expect(getMaxInlineBytes('image')).toBe(0);
  });
});
