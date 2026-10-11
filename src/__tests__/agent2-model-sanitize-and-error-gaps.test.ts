/**
 * Test coverage for confirmed untested code paths:
 *
 * 1. sanitizeModelRecordForOutput (model-cache.ts) — ZERO prior test coverage.
 *    Security function that strips prototype-pollution keys from model records
 *    before forwarding to MCP clients. Tests: fast path (no unsafe keys),
 *    __proto__/constructor/prototype stripping, multiple unsafe keys, mixed
 *    safe+unsafe, preserves non-unsafe record fields, returns same ref on
 *    fast path.
 *
 * 2. toolError edge cases (errors.ts):
 *    - Empty suggestions array omitted from _meta
 *    - Message at exactly MAX_SANITIZED_ERROR_LENGTH (2048) — no truncation
 *    - retry_after_seconds omitted when not a number
 *
 * 3. readToolPayload edge cases (structured-output.ts):
 *    - Throws when content exists but first element has no text property
 *    - Reads structuredContent even when it's falsy (e.g., 0, empty string, false)
 *
 * 4. extractCompletionText refusal branch (completion-utils.ts):
 *    - Returns refusal text with reasoning attached
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests in src/__tests__/ — it does NOT modify source code.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeModelRecordForOutput, type OpenRouterModelRecord } from '../model-cache.js';
import { toolError, toolErrorFrom, ErrorCode } from '../errors.js';
import { readToolPayload } from '../tool-handlers/structured-output.js';
import { extractCompletionText } from '../tool-handlers/completion-utils.js';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';

// ═══════════════════════════════════════════════════════════════════════════
// 1. sanitizeModelRecordForOutput — prototype-pollution key stripping
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeModelRecordForOutput', () => {
  it('returns the same reference when no unsafe keys are present (fast path)', () => {
    const record: OpenRouterModelRecord = {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      context_length: 128_000,
      architecture: { input_modalities: ['text', 'image'] },
    };
    const result = sanitizeModelRecordForOutput(record);
    // Fast path: same reference, no copy needed
    expect(result).toBe(record);
    expect(result.id).toBe('openai/gpt-4o');
    expect(result.name).toBe('GPT-4o');
  });

  it('strips __proto__ key from model record', () => {
    const record = Object.create(null) as OpenRouterModelRecord;
    record.id = 'test/model';
    record.name = 'Test';
    record['__proto__'] = { polluted: true };
    const result = sanitizeModelRecordForOutput(record);
    // Should return a new object without __proto__
    expect(result).not.toBe(record);
    expect(result.id).toBe('test/model');
    expect(result.name).toBe('Test');
    expect(Object.hasOwn(result, '__proto__')).toBe(false);
  });

  it('strips constructor key from model record', () => {
    const record = Object.create(null) as OpenRouterModelRecord;
    record.id = 'test/model';
    record.name = 'Test';
    record['constructor'] = 'polluted';
    const result = sanitizeModelRecordForOutput(record);
    expect(result).not.toBe(record);
    expect(result.id).toBe('test/model');
    expect(Object.keys(result)).not.toContain('constructor');
  });

  it('strips prototype key from model record', () => {
    const record = Object.create(null) as OpenRouterModelRecord;
    record.id = 'test/model';
    record['prototype'] = {};
    const result = sanitizeModelRecordForOutput(record);
    expect(result).not.toBe(record);
    expect(result.id).toBe('test/model');
    expect(Object.keys(result)).not.toContain('prototype');
  });

  it('strips multiple unsafe keys at once', () => {
    const record = Object.create(null) as OpenRouterModelRecord;
    record.id = 'test/model';
    record.name = 'Test Model';
    record['__proto__'] = 'attack1';
    record['constructor'] = 'attack2';
    record['prototype'] = 'attack3';
    const result = sanitizeModelRecordForOutput(record);
    expect(result.id).toBe('test/model');
    expect(result.name).toBe('Test Model');
    const keys = Object.keys(result);
    expect(keys).not.toContain('__proto__');
    expect(keys).not.toContain('constructor');
    expect(keys).not.toContain('prototype');
    expect(keys).toEqual(['id', 'name']);
  });

  it('preserves all non-unsafe fields including nested objects', () => {
    const record = Object.create(null) as OpenRouterModelRecord;
    record.id = 'anthropic/claude-3.5-sonnet';
    record.name = 'Claude 3.5 Sonnet';
    record.context_length = 200_000;
    record.architecture = { input_modalities: ['text', 'image'], output_modalities: ['text'] };
    record.pricing = { prompt: '0.003', completion: '0.015' };
    record['__proto__'] = 'should be stripped';
    const result = sanitizeModelRecordForOutput(record);
    expect(result.id).toBe('anthropic/claude-3.5-sonnet');
    expect(result.name).toBe('Claude 3.5 Sonnet');
    expect(result.context_length).toBe(200_000);
    expect(result.architecture).toEqual({
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
    });
    expect(result.pricing).toEqual({ prompt: '0.003', completion: '0.015' });
    expect(Object.hasOwn(result, '__proto__')).toBe(false);
  });

  it('handles record with only id and no other fields', () => {
    const record: OpenRouterModelRecord = { id: 'openai/gpt-3.5-turbo' };
    const result = sanitizeModelRecordForOutput(record);
    expect(result).toBe(record); // fast path
    expect(result.id).toBe('openai/gpt-3.5-turbo');
  });

  it('handles record with unknown extra fields (passthrough)', () => {
    const record = Object.create(null) as OpenRouterModelRecord;
    record.id = 'meta/llama-3';
    record.custom_field = 'allowed';
    record.top_provider = { max_completion_tokens: 4096 };
    const result = sanitizeModelRecordForOutput(record);
    expect(result).toBe(record); // fast path — no unsafe keys
    expect(result.custom_field).toBe('allowed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. toolError — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('toolError — edge cases', () => {
  it('omits suggestions from _meta when suggestions array is empty', () => {
    const r = toolError(ErrorCode.INVALID_INPUT, 'bad input', undefined, {
      suggestions: [],
    });
    expect(r._meta.suggestions).toBeUndefined();
    expect(r.isError).toBe(true);
  });

  it('does not truncate message at exactly 2048 characters', () => {
    const msg = 'x'.repeat(2048);
    const r = toolError(ErrorCode.INTERNAL, msg);
    expect(r.content[0].text).toBe(msg);
    expect(r.content[0].text).toHaveLength(2048);
  });

  it('truncates message at 2049 characters with trailing …', () => {
    const msg = 'y'.repeat(2049);
    const r = toolError(ErrorCode.INTERNAL, msg);
    expect(r.content[0].text.length).toBeLessThanOrEqual(2049);
    expect(r.content[0].text.endsWith('…')).toBe(true);
  });

  it('omits retry_after_seconds when it is not a number', () => {
    const r = toolError(ErrorCode.UPSTREAM_HTTP, 'error', undefined, {
      retry_after_seconds: 'soon' as unknown as number,
    });
    expect(r._meta.retry_after_seconds).toBeUndefined();
  });

  it('includes retry_after_seconds when it is 0', () => {
    const r = toolError(ErrorCode.UPSTREAM_HTTP, 'error', undefined, {
      retry_after_seconds: 0,
    });
    expect(r._meta.retry_after_seconds).toBe(0);
  });

  it('includes both suggestions and details when provided', () => {
    const r = toolError(
      ErrorCode.MODEL_NOT_FOUND,
      'model not found',
      { model: 'bad/model' },
      { suggestions: ['Use search_models'] },
    );
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
    expect(r._meta.details).toEqual({ model: 'bad/model' });
    expect(r._meta.suggestions).toEqual(['Use search_models']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. toolErrorFrom — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('toolErrorFrom — additional edge cases', () => {
  it('handles numeric error value (falls back to unknown error)', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, 42);
    expect(r.content[0].text).toBe('unknown error');
  });

  it('handles boolean error value (falls back to unknown error)', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, true);
    expect(r.content[0].text).toBe('unknown error');
  });

  it('handles null error value (falls back to unknown error)', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, null);
    expect(r.content[0].text).toBe('unknown error');
  });

  it('handles undefined error value (falls back to unknown error)', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, undefined);
    expect(r.content[0].text).toBe('unknown error');
  });

  it('passes suggestions through to the result', () => {
    const r = toolErrorFrom(ErrorCode.UPSTREAM_HTTP, new Error('server error'), 'rerank', {
      suggestions: ['Retry later'],
    });
    expect(r._meta.suggestions).toEqual(['Retry later']);
    expect(r.content[0].text).toContain('rerank');
  });

  it('handles prefix as undefined (no prefix applied)', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, new Error('boom'), undefined);
    expect(r.content[0].text).toBe('boom');
  });

  it('handles prefix as empty string (no prefix applied)', () => {
    const r = toolErrorFrom(ErrorCode.INTERNAL, new Error('crash'), '');
    expect(r.content[0].text).toBe('crash');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. readToolPayload — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('readToolPayload — additional edge cases', () => {
  it('prefers structuredContent even when it is 0 (falsy but defined)', () => {
    const payload = readToolPayload({
      structuredContent: 0 as unknown,
      content: [{ type: 'text', text: '{"fallback":true}' }],
    });
    expect(payload).toBe(0);
  });

  it('prefers structuredContent even when it is false (falsy but defined)', () => {
    const payload = readToolPayload({
      structuredContent: false as unknown,
      content: [{ type: 'text', text: '{"fallback":true}' }],
    });
    expect(payload).toBe(false);
  });

  it('prefers structuredContent even when it is empty string (falsy but defined)', () => {
    const payload = readToolPayload({
      structuredContent: '' as unknown,
      content: [{ type: 'text', text: '{"fallback":true}' }],
    });
    expect(payload).toBe('');
  });

  it('throws when content text is undefined (no text property)', () => {
    expect(() =>
      readToolPayload({
        content: [{ type: 'image' }],
      }),
    ).toThrow(/no structuredContent/);
  });

  it('throws when content is undefined', () => {
    expect(() => readToolPayload({})).toThrow(/no structuredContent/);
  });

  it('parses JSON from first content text when structuredContent is undefined', () => {
    const payload = readToolPayload({
      structuredContent: undefined,
      content: [{ type: 'text', text: '{"key":"value"}' }],
    });
    expect(payload).toEqual({ key: 'value' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. extractCompletionText — refusal with reasoning
// ═══════════════════════════════════════════════════════════════════════════

describe('extractCompletionText — refusal branch', () => {
  it('returns refusal text when msg.refusal is a non-empty string', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: null,
            refusal: 'I cannot help with that request.',
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('I cannot help with that request.');
    expect(r.reasonedOnly).toBe(false);
  });

  it('returns refusal text even when content is also present', () => {
    // refusal takes priority over content in the code — let's verify
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: 'Some content',
            refusal: 'Blocked by policy.',
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    // Refusal is checked before content
    expect(r.text).toBe('Blocked by policy.');
    expect(r.reasonedOnly).toBe(false);
  });

  it('attaches reasoning to refusal when both are present', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: '',
            refusal: 'I must decline.',
            reasoning: 'The request violates policy.',
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('I must decline.');
    expect(r.reasoning).toBe('The request violates policy.');
    expect(r.reasonedOnly).toBe(false);
  });

  it('skips empty refusal string and falls through to content', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: 'Actual answer.',
            refusal: '',
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('Actual answer.');
  });

  it('skips null refusal and falls through to content', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: 'Answer here.',
            refusal: null,
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('Answer here.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. extractCompletionText — no choices
// ═══════════════════════════════════════════════════════════════════════════

describe('extractCompletionText — no choices at all', () => {
  it('returns empty when choices is undefined', () => {
    const r = extractCompletionText({
      choices: undefined,
    } as unknown as ChatCompletion);
    expect(r.text).toBe('');
    expect(r.reasonedOnly).toBe(false);
    expect(r.finishReason).toBeUndefined();
  });

  it('returns empty when choices is empty array', () => {
    const r = extractCompletionText({
      choices: [],
    } as unknown as ChatCompletion);
    expect(r.text).toBe('');
    expect(r.reasonedOnly).toBe(false);
  });

  it('returns empty when choices is null', () => {
    const r = extractCompletionText({
      choices: null,
    } as unknown as ChatCompletion);
    expect(r.text).toBe('');
  });
});
