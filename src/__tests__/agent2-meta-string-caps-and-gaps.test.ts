/**
 * Agent 2 — Genuinely untested code paths in completion-utils.ts and
 * cross-handler contract verification for embed_text / decide.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds NEW test cases in src/__tests__/ and does NOT modify source code.
 *
 * Targets verified to have ZERO prior test coverage via exhaustive grep:
 *
 * completion-utils.ts — capMetaString / MAX_FINISH_REASON_LENGTH (64):
 *  1. buildCompletionMeta truncates finish_reason exceeding 64 chars
 *  2. buildCompletionMeta preserves finish_reason at exactly 64 chars
 *  3. buildCompletionMeta truncates native_finish_reason exceeding 64 chars
 *  4. buildCompletionMeta preserves native_finish_reason at exactly 64 chars
 *  5. buildCompletionMeta sets finish_reason to undefined for non-string values
 *  6. buildCompletionMeta omits native_finish_reason for empty-string values
 *  7. buildCompletionMeta omits native_finish_reason for null values
 *
 * completion-utils.ts — classifyEmptyCompletion native_finish_reason:
 *  8. classifyEmptyCompletion includes native_finish_reason in details when present
 *  9. classifyEmptyCompletion omits native_finish_reason from details when absent
 *
 * completion-utils.ts — detectReasoningCutoff usage sanitization:
 * 10. detectReasoningCutoff sanitizes usage with mixed valid/invalid fields
 * 11. detectReasoningCutoff strips non-numeric usage fields from details
 *
 * Cross-handler response contract — embed_text and decide:
 * 12. embed_text success response has exactly the expected top-level keys
 * 13. decide success response has exactly the expected top-level keys
 * 14. embed_text error response has exactly the expected error shape
 * 15. decide error response has exactly the expected error shape
 * 16. embed_text _meta never contains prototype-pollution keys
 * 17. decide _meta never contains prototype-pollution keys
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildCompletionMeta,
  classifyEmptyCompletion,
  detectReasoningCutoff,
  type ExtractedText,
} from '../tool-handlers/completion-utils.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { ErrorCode } from '../errors.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseExtracted: ExtractedText = {
  text: 'Hello world',
  reasonedOnly: false,
  finishReason: 'stop',
  nativeFinishReason: undefined,
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; details?: Record<string, unknown> };
};

function mockEmbedClient(response: unknown) {
  const createEmbeddings = vi.fn().mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  const submitDecision = vi.fn().mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQ(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Yes', no: 'No' },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–7. buildCompletionMeta — finish_reason / native_finish_reason capping
//      via capMetaString at MAX_FINISH_REASON_LENGTH (64)
// ═══════════════════════════════════════════════════════════════════════════

describe('buildCompletionMeta — finish_reason length capping (MAX_FINISH_REASON_LENGTH=64)', () => {
  it('truncates finish_reason exceeding 64 chars', () => {
    const longReason = 'x'.repeat(100);
    const e: ExtractedText = { ...baseExtracted, finishReason: longReason as 'stop' };
    const meta = buildCompletionMeta(e);
    // capMetaString slices to 64 chars
    expect(typeof meta.finish_reason).toBe('string');
    expect((meta.finish_reason as string).length).toBe(64);
    expect(meta.finish_reason).toBe(longReason.slice(0, 64));
  });

  it('preserves finish_reason at exactly 64 chars', () => {
    const exactReason = 'y'.repeat(64);
    const e: ExtractedText = { ...baseExtracted, finishReason: exactReason as 'stop' };
    const meta = buildCompletionMeta(e);
    expect(meta.finish_reason).toBe(exactReason);
  });

  it('truncates native_finish_reason exceeding 64 chars', () => {
    const longNative = 'n'.repeat(200);
    const e: ExtractedText = { ...baseExtracted, nativeFinishReason: longNative };
    const meta = buildCompletionMeta(e);
    expect(typeof meta.native_finish_reason).toBe('string');
    expect((meta.native_finish_reason as string).length).toBe(64);
    expect(meta.native_finish_reason).toBe(longNative.slice(0, 64));
  });

  it('preserves native_finish_reason at exactly 64 chars', () => {
    const exactNative = 'z'.repeat(64);
    const e: ExtractedText = { ...baseExtracted, nativeFinishReason: exactNative };
    const meta = buildCompletionMeta(e);
    expect(meta.native_finish_reason).toBe(exactNative);
  });

  it('sets finish_reason to undefined for non-string finishReason (number)', () => {
    const e: ExtractedText = {
      ...baseExtracted,
      finishReason: 42 as unknown as 'stop',
    };
    const meta = buildCompletionMeta(e);
    // capMetaString returns undefined for non-string
    expect(meta.finish_reason).toBeUndefined();
  });

  it('omits native_finish_reason when it is empty string', () => {
    const e: ExtractedText = { ...baseExtracted, nativeFinishReason: '' };
    const meta = buildCompletionMeta(e);
    // capMetaString returns undefined for empty string
    expect(meta).not.toHaveProperty('native_finish_reason');
  });

  it('omits native_finish_reason when it is null', () => {
    const e: ExtractedText = {
      ...baseExtracted,
      nativeFinishReason: null as unknown as string,
    };
    const meta = buildCompletionMeta(e);
    // capMetaString returns undefined for non-string (null)
    expect(meta).not.toHaveProperty('native_finish_reason');
  });

  it('preserves short finish_reason and short native_finish_reason', () => {
    const e: ExtractedText = {
      ...baseExtracted,
      finishReason: 'stop',
      nativeFinishReason: 'end_turn',
    };
    const meta = buildCompletionMeta(e);
    expect(meta.finish_reason).toBe('stop');
    expect(meta.native_finish_reason).toBe('end_turn');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8–9. classifyEmptyCompletion — native_finish_reason in error details
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyEmptyCompletion — native_finish_reason in details', () => {
  it('includes native_finish_reason in details when present', () => {
    const e: ExtractedText = {
      text: '',
      reasonedOnly: false,
      finishReason: 'content_filter',
      nativeFinishReason: 'safety_system_intervention',
    };
    const r = classifyEmptyCompletion(e, 'chat_completion');
    expect(r._meta.code).toBe(ErrorCode.UPSTREAM_REFUSED);
    expect(r._meta.details?.native_finish_reason).toBe('safety_system_intervention');
    expect(r._meta.details?.finish_reason).toBe('content_filter');
  });

  it('omits native_finish_reason from details when absent', () => {
    const e: ExtractedText = {
      text: '',
      reasonedOnly: false,
      finishReason: 'length',
      nativeFinishReason: undefined,
    };
    const r = classifyEmptyCompletion(e, 'analyze_image');
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r._meta.details?.finish_reason).toBe('length');
    expect(r._meta.details).not.toHaveProperty('native_finish_reason');
  });

  it('includes native_finish_reason for default (INTERNAL) case', () => {
    const e: ExtractedText = {
      text: '',
      reasonedOnly: false,
      finishReason: 'stop',
      nativeFinishReason: 'model_specific_reason',
    };
    const r = classifyEmptyCompletion(e, 'test');
    expect(r._meta.code).toBe(ErrorCode.INTERNAL);
    expect(r._meta.details?.native_finish_reason).toBe('model_specific_reason');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10–11. detectReasoningCutoff — usage sanitization in error details
// ═══════════════════════════════════════════════════════════════════════════

describe('detectReasoningCutoff — usage sanitization in error details', () => {
  it('sanitizes usage with mixed valid/invalid fields', () => {
    const e: ExtractedText = {
      text: 'thinking about this...',
      reasonedOnly: true,
      finishReason: 'length',
      nativeFinishReason: undefined,
      usage: {
        prompt_tokens: 100,
        completion_tokens: 500,
        total_tokens: 600,
        unknown_field: 'should be stripped',
        another_extra: { nested: true },
      } as unknown as ExtractedText['usage'],
    };
    const r = detectReasoningCutoff(e);
    expect(r).not.toBeNull();
    expect(r!._meta.code).toBe(ErrorCode.INVALID_INPUT);
    // Sanitized usage should only contain known numeric fields
    const usage = r!._meta.details?.usage as Record<string, unknown> | undefined;
    expect(usage).toBeDefined();
    expect(usage!.prompt_tokens).toBe(100);
    expect(usage!.completion_tokens).toBe(500);
    expect(usage!.total_tokens).toBe(600);
    // Extraneous fields should be stripped
    expect(usage).not.toHaveProperty('unknown_field');
    expect(usage).not.toHaveProperty('another_extra');
  });

  it('strips non-numeric usage fields (NaN, Infinity, strings)', () => {
    const e: ExtractedText = {
      text: 'deep thinking',
      reasonedOnly: true,
      finishReason: 'length',
      nativeFinishReason: undefined,
      usage: {
        prompt_tokens: NaN,
        completion_tokens: Infinity,
        total_tokens: 'many' as unknown as number,
        cost: 0.01,
      } as unknown as ExtractedText['usage'],
    };
    const r = detectReasoningCutoff(e);
    expect(r).not.toBeNull();
    const usage = r!._meta.details?.usage as Record<string, unknown> | undefined;
    // Only cost should survive sanitization (valid finite number)
    expect(usage).toBeDefined();
    expect(usage!.cost).toBe(0.01);
    expect(usage).not.toHaveProperty('prompt_tokens');
    expect(usage).not.toHaveProperty('completion_tokens');
    expect(usage).not.toHaveProperty('total_tokens');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12–17. Cross-handler response contract — embed_text and decide
// ═══════════════════════════════════════════════════════════════════════════

describe('embed_text — success response contract', () => {
  it('has exactly the expected top-level keys: content, structuredContent, _meta', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 'openai/text-embedding-3-small',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as SuccessResult;

    // Top-level keys
    const topKeys = Object.keys(r).sort();
    expect(topKeys).toEqual(['_meta', 'content', 'structuredContent']);

    // content shape
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
    expect(typeof r.content[0].text).toBe('string');

    // structuredContent required fields
    expect(r.structuredContent).toHaveProperty('embeddings');
    expect(r.structuredContent).toHaveProperty('model');
    expect(r.structuredContent).toHaveProperty('dimensions');
    expect(Array.isArray(r.structuredContent.embeddings)).toBe(true);
    expect(typeof r.structuredContent.model).toBe('string');
    expect(typeof r.structuredContent.dimensions).toBe('number');

    // _meta required fields
    expect(r._meta).toHaveProperty('server_version');
    expect(r._meta).toHaveProperty('model');
    expect(r._meta).toHaveProperty('embedding_count');
    expect(r._meta).toHaveProperty('dimensions');
    expect(r._meta).toHaveProperty('usage');
  });
});

describe('decide — success response contract', () => {
  it('has exactly the expected top-level keys: content, structuredContent, _meta', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.75 } },
      usage: { cost: 0.001 },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;

    const topKeys = Object.keys(r).sort();
    expect(topKeys).toEqual(['_meta', 'content', 'structuredContent']);

    // content shape
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
    expect(typeof r.content[0].text).toBe('string');

    // structuredContent required fields
    expect(r.structuredContent).toHaveProperty('answers');
    expect(typeof r.structuredContent.answers).toBe('object');

    // _meta required fields
    expect(r._meta).toHaveProperty('server_version');
    expect(r._meta).toHaveProperty('model');
    expect(r._meta).toHaveProperty('question_count');
    expect(r._meta).toHaveProperty('usage');
  });
});

describe('embed_text — error response contract', () => {
  it('has exactly the expected error shape: content, isError, _meta with code', async () => {
    const r = (await handleEmbedText(embedReq({}), mockEmbedClient({}))) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
    expect(typeof r.content[0].text).toBe('string');
    expect(typeof r._meta.code).toBe('string');
  });
});

describe('decide — error response contract', () => {
  it('has exactly the expected error shape: content, isError, _meta with code', async () => {
    const r = (await handleDecide(decideReq({}), mockDecideClient({}))) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
    expect(typeof r.content[0].text).toBe('string');
    expect(typeof r._meta.code).toBe('string');
  });
});

describe('embed_text — _meta never contains prototype-pollution keys', () => {
  it('sanitizes _meta even when upstream usage has exotic keys', async () => {
    const usage = Object.create(null);
    usage.prompt_tokens = 10;
    usage.total_tokens = 10;
    // These should NOT appear in _meta.usage
    usage['toString'] = 'attack';
    usage['valueOf'] = 42;

    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'test/model',
      usage,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as SuccessResult;

    // Usage should only have the known sanitized fields as own properties
    const safeUsage = r._meta.usage as Record<string, unknown> | undefined;
    if (safeUsage) {
      const ownKeys = Object.keys(safeUsage);
      expect(ownKeys).not.toContain('toString');
      expect(ownKeys).not.toContain('valueOf');
      expect(ownKeys.every((k) => typeof safeUsage[k] === 'number')).toBe(true);
    }

    // Top-level _meta should not have unsafe own keys
    const metaKeys = Object.keys(r._meta);
    expect(metaKeys).not.toContain('__proto__');
    expect(metaKeys).not.toContain('constructor');
    expect(metaKeys).not.toContain('prototype');
  });
});

describe('decide — _meta never contains prototype-pollution keys', () => {
  it('sanitizes _meta even when upstream usage has exotic keys', async () => {
    const usage = Object.create(null);
    usage.cost = 0.001;
    usage['toString'] = 'attack';
    usage['hasOwnProperty'] = 'leak';

    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
      usage,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;

    const safeUsage = r._meta.usage as Record<string, unknown> | undefined;
    if (safeUsage) {
      const ownKeys = Object.keys(safeUsage);
      expect(ownKeys).not.toContain('toString');
      expect(ownKeys).not.toContain('hasOwnProperty');
      expect(ownKeys.every((k) => typeof safeUsage[k] === 'number')).toBe(true);
    }

    const metaKeys = Object.keys(r._meta);
    expect(metaKeys).not.toContain('__proto__');
    expect(metaKeys).not.toContain('constructor');
    expect(metaKeys).not.toContain('prototype');
  });
});
