/**
 * Final comprehensive coverage for genuinely untested branches.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets:
 *
 * completion-utils.ts:
 *  1. extractCompletionText catch block — when internal processing throws
 *  2. extractCompletionText with content: null (explicit null)
 *  3. extractCompletionText with reasoning_details containing only non-text entries
 *  4. toUsageMeta when usage has only non-numeric fields → returns undefined
 *  5. toUsageMeta when usage has __proto__ → returns undefined
 *  6. buildCompletionMeta with empty-string reasoning and includeReasoning: true
 *  7. buildCompletionMeta when usage sanitization fails (usage present, no valid fields)
 *  8. capResultText with max=0 disabled returns text as-is (via readMaxResultTextChars)
 *
 * embed_text:
 *  9. Upstream response.model is explicitly null → safeResponseModel = undefined
 * 10. Batch where second text triggers validation before aggregate check
 * 11. Usage present but only unknown keys → _meta.usage omitted
 *
 * decide:
 * 12. Questions serialized at exactly MAX_QUESTIONS_BYTES boundary → passes
 * 13. State at exactly depth 32 with no unsafe key → accepts (within limit)
 * 14. Score answer where score is a number (not array) → safeScore undefined
 * 15. Choice summary with __proto__ key filtered from upstream sort
 * 16. Response where answer type is object (not string) → safeType = 'unknown'
 * 17. Noul answer where noul is missing entirely → safeNoul undefined, summary 0.0%
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import {
  extractCompletionText,
  toUsageMeta,
  buildCompletionMeta,
  capResultText,
  type ExtractedText,
} from '../tool-handlers/completion-utils.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type EmbedSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
};

type DecideSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    answers: Record<
      string,
      {
        type: string;
        noul?: number;
        choice?: Record<string, number>;
        score?: number[];
      }
    >;
  };
  _meta: Record<string, unknown>;
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

function noulQuestion(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

function choiceQuestion(instructions = 'Pick a color') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { red: 'Color red', blue: 'Color blue', green: 'Color green' },
  };
}

function scoreQuestion(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. extractCompletionText catch block
// ═══════════════════════════════════════════════════════════════════════════

describe('extractCompletionText — catch block', () => {
  it('returns empty ExtractedText when choices getter throws', () => {
    // Create an object whose `choices` property throws when accessed,
    // forcing the catch block in extractCompletionText to execute.
    const malformed = {
      get choices(): never {
        throw new Error('unexpected getter error');
      },
    };
    const r = extractCompletionText(malformed as unknown as ChatCompletion);
    expect(r.text).toBe('');
    expect(r.reasonedOnly).toBe(false);
    expect(r.finishReason).toBeUndefined();
    expect(r.nativeFinishReason).toBeUndefined();
    expect(r.usage).toBeUndefined();
  });

  it('returns empty ExtractedText when message.content getter throws', () => {
    const msg = {
      get content(): never {
        throw new TypeError('cannot read content');
      },
    };
    const malformed = {
      choices: [{ message: msg, finish_reason: 'stop' }],
    };
    const r = extractCompletionText(malformed as unknown as ChatCompletion);
    expect(r.text).toBe('');
    expect(r.reasonedOnly).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. extractCompletionText with content: null
// ═══════════════════════════════════════════════════════════════════════════

describe('extractCompletionText — null content', () => {
  it('returns empty text when content is null and no reasoning', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: { content: null },
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('');
    expect(r.reasonedOnly).toBe(false);
  });

  it('falls through to reasoning when content is null', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: { content: null, reasoning: 'deep thought' } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('deep thought');
    expect(r.reasonedOnly).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. extractCompletionText with reasoning_details all non-text
// ═══════════════════════════════════════════════════════════════════════════

describe('extractCompletionText — reasoning_details all filtered', () => {
  it('returns empty reasoning when all details are non-text type', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: '',
            reasoning_details: [
              { type: 'redacted' },
              { type: 'image', text: undefined },
              { type: 'unknown_type' },
            ],
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    // All reasoning_details filtered → joined = '' → reasoning = undefined
    // Content is '' → empty → no reasoning fallback
    expect(r.text).toBe('');
    expect(r.reasonedOnly).toBe(false);
    expect(r.reasoning).toBeUndefined();
  });

  it('filters reasoning_details where text is non-string', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: '',
            reasoning_details: [
              { type: 'text', text: 42 },
              { type: 'text', text: null },
              { type: 'text', text: 'valid' },
            ],
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('valid');
    expect(r.reasonedOnly).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4-5. toUsageMeta edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('toUsageMeta — edge cases', () => {
  it('returns undefined when usage has only unknown/non-numeric fields', () => {
    const usage = {
      custom_field: 'not a number',
      other_field: { nested: true },
    } as unknown as ChatCompletion['usage'];
    expect(toUsageMeta(usage)).toBeUndefined();
  });

  it('returns undefined when usage has NaN/Infinity for known fields', () => {
    const usage = {
      prompt_tokens: NaN,
      completion_tokens: Infinity,
      total_tokens: -Infinity,
    } as unknown as ChatCompletion['usage'];
    expect(toUsageMeta(usage)).toBeUndefined();
  });

  it('returns undefined when usage has __proto__ key (prototype pollution)', () => {
    const usage = Object.create(null);
    usage['__proto__'] = 100;
    usage.prompt_tokens = 10;
    expect(toUsageMeta(usage as unknown as ChatCompletion['usage'])).toBeUndefined();
  });

  it('returns only valid numeric fields from mixed usage', () => {
    const usage = {
      prompt_tokens: 15,
      completion_tokens: 'not a number',
      total_tokens: 30,
      unknown_field: 42,
    } as unknown as ChatCompletion['usage'];
    const result = toUsageMeta(usage);
    expect(result).toEqual({ usage: { prompt_tokens: 15, total_tokens: 30 } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6-7. buildCompletionMeta edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('buildCompletionMeta — edge cases', () => {
  afterEach(() => vi.unstubAllEnvs());

  const base: ExtractedText = {
    text: 'hello',
    reasonedOnly: false,
    finishReason: 'stop',
    nativeFinishReason: undefined,
  };

  it('omits reasoning when reasoning is empty string and includeReasoning is true', () => {
    const e: ExtractedText = { ...base, reasoning: '' };
    const m = buildCompletionMeta(e, { includeReasoning: true });
    // Empty string is falsy, so `extracted.reasoning && ...` short-circuits
    expect(m).not.toHaveProperty('reasoning');
    expect(m).not.toHaveProperty('reasoning_truncated');
  });

  it('omits usage from meta when usage sanitization returns undefined', () => {
    const e: ExtractedText = {
      ...base,
      usage: { not_a_known_field: 42 } as unknown as ChatCompletion['usage'],
    };
    const m = buildCompletionMeta(e);
    // sanitizeUpstreamUsage returns undefined for unknown-only fields
    expect(m).not.toHaveProperty('usage');
  });

  it('does not truncate reasoning when cap is disabled (env=0)', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '0');
    const longReasoning = 'x'.repeat(1_000_000);
    const e: ExtractedText = { ...base, reasoning: longReasoning };
    const m = buildCompletionMeta(e, { includeReasoning: true });
    expect(m.reasoning).toBe(longReasoning);
    expect(m.reasoning_truncated).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. capResultText with disabled max (env=0)
// ═══════════════════════════════════════════════════════════════════════════

describe('capResultText — disabled (max=0)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns very long text without truncation when max=0', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '0');
    const longText = 'a'.repeat(2_000_000);
    const r = capResultText(longText);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe(longText);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. embed_text — response.model is null
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — response.model null fallback', () => {
  it('falls back to effective model when response.model is null', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: null,
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: 'custom/model' }),
      client,
    )) as EmbedSuccessResult;
    // typeof null !== 'string' → safeResponseModel = undefined → displayModel = effectiveModel
    expect(r.structuredContent.model).toBe('custom/model');
    expect(r._meta.model).toBe('custom/model');
    expect(r.content[0].text).toContain('custom/model');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. embed_text — batch validation order
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — batch validation stops at first error', () => {
  it('reports first non-string element before checking later empty strings', async () => {
    // texts[0] is valid, texts[1] is non-string (42), texts[2] is empty string
    // Should fail on texts[1] (non-string) before reaching texts[2]
    const r = (await handleEmbedText(
      embedReq({ texts: ['valid', 42, ''] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[1]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('reports empty string at index 0 before reaching long text at index 1', async () => {
    const longText = 'a'.repeat(100_001);
    const r = (await handleEmbedText(
      embedReq({ texts: ['', longText] }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('empty');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. embed_text — usage with only unknown keys
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — usage sanitization strips unknown keys', () => {
  it('omits usage from _meta when response.usage has only unknown keys', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'test/model',
      usage: { unknown_key: 999, another: 'string' },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r._meta.usage).toBeUndefined();
  });

  it('includes only valid known fields from mixed usage', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'test/model',
      usage: { prompt_tokens: 5, unknown_key: 'bad', total_tokens: NaN },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r._meta.usage).toEqual({ prompt_tokens: 5 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. decide — questions at exact MAX_QUESTIONS_BYTES boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — questions bytes boundary', () => {
  it('accepts questions within MAX_QUESTIONS_BYTES (under 1_000_000)', async () => {
    // Use a moderately sized questions object well under the limit
    const questions: Record<string, unknown> = {};
    const answers: Record<string, unknown> = {};
    for (let i = 0; i < 5; i++) {
      const criteria: Record<string, string> = {};
      for (let c = 0; c < 20; c++) {
        criteria[`opt_${c}`] = 'v'.repeat(200);
      }
      questions[`q${i}`] = { type: 'noul', instructions: 'test', criteria };
      answers[`q${i}`] = { type: 'noul', noul: 0.5 };
    }
    const size = JSON.stringify(questions).length;
    expect(size).toBeLessThan(1_000_000);

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(decideReq({ questions }), client)) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
  });

  it('rejects questions over MAX_QUESTIONS_BYTES (1_000_000)', async () => {
    // Build questions that exceed the aggregate size limit by using many
    // questions × many criteria entries, all within per-field limits.
    const questions: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      const criteria: Record<string, string> = {};
      for (let c = 0; c < 50; c++) {
        criteria[`opt_${c}`] = 'x'.repeat(500);
      }
      questions[`q${i}`] = { type: 'choice', instructions: 'pick', criteria };
    }
    const size = JSON.stringify(questions).length;
    expect(size).toBeGreaterThan(1_000_000);

    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('serialized size');
    expect(r.content[0].text).toContain('1000000');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. decide — state at depth 32 with no unsafe key
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — state nesting at exactly depth 32 (safe)', () => {
  it('accepts deeply nested state at depth 31 wrapping levels with no unsafe keys', async () => {
    // hasDeepUnsafeKey is called with initial depth=0.
    // With 31 wrapping levels, the leaf { data: 'leaf' } is at depth 31.
    // The string 'leaf' would be checked at depth 32.
    // At depth 32: `32 > 32` is false → proceeds → typeof 'leaf' !== 'object' → null.
    // So this should SUCCEED.
    let obj: Record<string, unknown> = { data: 'leaf' };
    for (let i = 0; i < 31; i++) {
      obj = { nested: obj };
    }
    expect(JSON.stringify(obj).length).toBeLessThan(100_000);

    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state: obj }),
      client,
    )) as DecideSuccessResult;
    expect(r.structuredContent.answers).toBeDefined();
    expect(r.content[0].text).toContain('YES');
  });

  it('rejects state at 32 wrapping levels (leaf values checked at depth 33)', async () => {
    // With 32 wrapping levels, the leaf { data: 'leaf' } is at depth 32.
    // The string 'leaf' would be checked at depth 33.
    // At depth 33: `33 > 32` → DEPTH_EXCEEDED_SENTINEL → rejected.
    let obj: Record<string, unknown> = { data: 'leaf' };
    for (let i = 0; i < 32; i++) {
      obj = { nested: obj };
    }
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() }, state: obj }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('nesting depth');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. decide — score answer where score is a number
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score answer as number (not array)', () => {
  it('sets safeScore to undefined when score is a number', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: 42 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // typeof 42 !== array → safeScore = undefined
    expect(r.structuredContent.answers.q1?.score).toBeUndefined();
  });

  it('sets safeScore to undefined when score is an object', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: { 0: 0.5, 1: 0.5 } } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // Plain object is not an array → safeScore = undefined
    expect(r.structuredContent.answers.q1?.score).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. decide — choice summary with unsafe keys in upstream choice map
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — choice summary filters __proto__ from sort', () => {
  it('excludes __proto__ from summary line sort', async () => {
    const choice = Object.create(null);
    choice['__proto__'] = 0.99;
    choice['good'] = 0.8;
    choice['bad'] = 0.2;
    const client = mockDecideClient({
      answers: { q1: { type: 'choice', choice } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // __proto__ should be filtered from the choice sort in summary
    expect(r.content[0].text).toContain('good');
    expect(r.content[0].text).toContain('80.0%');
    expect(r.content[0].text).not.toContain('__proto__');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. decide — unknown answer type where rawType is object
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — unknown answer type with non-string rawType', () => {
  it('uses safeType "unknown" when answer.type is an object', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: { nested: true }, data: 'should be stripped' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // typeof { nested: true } !== 'string' → safeType = 'unknown'
    expect(r.structuredContent.answers.q1).toBeDefined();
    expect(r.structuredContent.answers.q1.type).toBe('unknown');
    // Extra properties should be stripped
    expect((r.structuredContent.answers.q1 as Record<string, unknown>).data).toBeUndefined();
  });

  it('uses safeType "unknown" when answer.type is undefined', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: undefined, noul: 0.5 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // typeof undefined !== 'string' → safeType = 'unknown'
    expect(r.structuredContent.answers.q1).toBeDefined();
    expect(r.structuredContent.answers.q1.type).toBe('unknown');
  });

  it('uses safeType "unknown" when answer.type is an array', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: ['noul', 'choice'] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // typeof ['noul', 'choice'] is 'object' (not 'string') → safeType = 'unknown'
    expect(r.structuredContent.answers.q1.type).toBe('unknown');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. decide — noul answer with noul field entirely missing
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — noul answer missing noul field in structuredContent', () => {
  it('sets safeNoul to undefined when noul field is absent', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul' } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // typeof undefined !== 'number' → safeNoul = undefined
    expect(r.structuredContent.answers.q1?.noul).toBeUndefined();
    // Summary should show "NO" with "0.0%" (default to 0 for missing noul)
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('sets safeNoul to undefined when noul is an object', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: { value: 0.9 } } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    // typeof { value: 0.9 } !== 'number' → safeNoul = undefined
    expect(r.structuredContent.answers.q1?.noul).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bonus: extractCompletionText — refusal takes priority over content
// ═══════════════════════════════════════════════════════════════════════════

describe('extractCompletionText — refusal priority', () => {
  it('returns refusal text even when content is also present', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: 'This is content',
            refusal: 'I cannot comply',
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    // Refusal check comes before content extraction
    expect(r.text).toBe('I cannot comply');
    expect(r.reasonedOnly).toBe(false);
  });

  it('returns refusal text over reasoning', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: '',
            refusal: 'Blocked by safety',
            reasoning: 'Some deep thought',
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('Blocked by safety');
    expect(r.reasoning).toBe('Some deep thought');
    expect(r.reasonedOnly).toBe(false);
  });

  it('skips empty refusal (empty string) and falls to content', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: 'actual answer',
            refusal: '',
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    // Empty refusal is falsy → skipped, falls through to content
    expect(r.text).toBe('actual answer');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bonus: decide — usage sanitization in _meta
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — usage sanitization', () => {
  it('omits usage from _meta when response.usage has only unknown keys', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
      usage: { unknown_field: 42, another: 'bad' },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r._meta.usage).toBeUndefined();
  });

  it('includes only known numeric fields from response.usage', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
      usage: { cost: 0.001, bad_field: 'string', prompt_tokens: NaN },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;
    expect(r._meta.usage).toEqual({ cost: 0.001 });
  });
});
