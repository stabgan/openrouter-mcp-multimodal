/**
 * Agent 2 — Remaining coverage gaps for embed_text, decide, errors,
 * completion-utils, and classifyUpstreamError.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets (identified by exhaustive diff of source branches vs every
 * existing test file):
 *
 * sanitizeErrorMessage (errors.ts):
 *  1. Exact pre-truncation boundary at MAX_SANITIZE_INPUT_LENGTH (8192 chars)
 *  2. Input at 8193 chars — first char past boundary is dropped before regex
 *  3. Output at exactly MAX_SANITIZED_ERROR_LENGTH (2048) — boundary precision
 *  4. Interaction: pre-truncation prevents secret leak at position > 8192
 *
 * decide (decide.ts) response summary:
 *  5. noul with negative value (-0.5) — valid finite number, NO at -50.0%
 *  6. score answer where all values are identical (first-wins tie)
 *  7. noul answer where `noul` is a boolean (typeof !== 'number' → P=0)
 *  8. Answer value is a number (non-object) — defensive continue
 *
 * embed_text (embed-text.ts):
 *  9. response.model is numeric 0 (falsy non-string) — falls back to effectiveModel
 *  10. response.model is explicit false — falls back to effectiveModel
 *  11. response with usage=null (not undefined) — should omit from _meta
 *
 * classifyUpstreamError (openrouter-errors.ts):
 *  12. "exceeds the model" context-length variant
 *  13. "too large" keyword without 413 status
 *  14. "Retry-After" as non-parseable string → undefined
 *  15. Nested string error field in extractMessage
 *  16. Object error without message or error — "unknown error"
 *
 * completion-utils:
 *  17. extractCompletionText with `choices: undefined` (not empty array)
 *  18. capResultText with env=0 (disabled) — no truncation for any length
 *  19. buildCompletionMeta with reasoning=undefined + includeReasoning=true
 *  20. classifyEmptyCompletion with null finish_reason (treated as default)
 *  21. extractCompletionText with content=null and no reasoning — empty string
 *  22. readMaxResultTextChars with float value like "1.5" — defaults
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sanitizeErrorMessage, ErrorCode, toolError } from '../errors.js';
import { classifyUpstreamError } from '../tool-handlers/openrouter-errors.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import {
  extractCompletionText,
  capResultText,
  buildCompletionMeta,
  classifyEmptyCompletion,
  readMaxResultTextChars,
  type ExtractedText,
} from '../tool-handlers/completion-utils.js';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

function mockDecideClient(response: unknown) {
  return {
    submitDecision: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function noulQ(instructions = 'test?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Yes', no: 'No' },
  };
}

// ---------------------------------------------------------------------------
// 1–4. sanitizeErrorMessage — exact pre-truncation boundary
// ---------------------------------------------------------------------------

describe('sanitizeErrorMessage — pre-truncation boundary (8192 chars)', () => {
  // MAX_SANITIZE_INPUT_LENGTH = 2048 * 4 = 8192
  // MAX_SANITIZED_ERROR_LENGTH = 2048
  // Use '! ' (non-base64 chars) to avoid triggering the base64 redaction regex.
  const SAFE_UNIT = '! ';

  it('processes input at exactly 8192 chars without pre-truncation', () => {
    const msg = SAFE_UNIT.repeat(4096); // 2 * 4096 = 8192
    expect(msg.length).toBe(8192);
    const result = sanitizeErrorMessage(msg);
    // Output is capped at 2048, so truncation marker is appended
    expect(result).toContain('truncated');
    // The first 2048 chars should be the original pattern
    expect(result.slice(0, 2048)).toBe(SAFE_UNIT.repeat(1024));
  });

  it('pre-truncates input at 8193 chars before regex processing', () => {
    // Place a marker at position 8192 (0-indexed) — it should be dropped
    const msg = SAFE_UNIT.repeat(4096) + 'MARKER';
    expect(msg.length).toBe(8192 + 6);
    const result = sanitizeErrorMessage(msg);
    // MARKER is at position 8192+, beyond the pre-truncation boundary
    expect(result).not.toContain('MARKER');
  });

  it('prevents secret leak at position > 8192', () => {
    // A secret placed beyond the pre-truncation boundary is dropped before
    // regex processing — and also before output due to post-truncation
    const prefix = SAFE_UNIT.repeat(4096); // 8192 chars
    const secret = ' Bearer sk-or-v1-verysecretkey123456789 ';
    const msg = prefix + secret;
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('sk-or-v1-verysecretkey123456789');
  });

  it('output at exactly 2048 chars is not truncated', () => {
    // Use non-base64 chars to avoid redaction
    const msg = SAFE_UNIT.repeat(1024); // 2 * 1024 = 2048
    expect(msg.length).toBe(2048);
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe(msg);
    expect(result.length).toBe(2048);
    expect(result).not.toContain('truncated');
  });

  it('output at 2049 chars IS truncated', () => {
    const msg = SAFE_UNIT.repeat(1024) + '!'; // 2049 chars
    expect(msg.length).toBe(2049);
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain('truncated');
    expect(result).toContain('1 chars omitted');
    // The first 2048 chars are preserved before the marker
    expect(result.startsWith(SAFE_UNIT.repeat(1024))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5–8. decide — response summary edge cases
// ---------------------------------------------------------------------------

describe('handleDecide — noul with negative probability', () => {
  it('renders noul=-0.5 as NO at -50.0%', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -0.5 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQ() },
      }),
      client,
    )) as SuccessResult;
    // -0.5 is finite, so prob=-0.5; -0.5 < 0.5 → NO
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('-50.0%');
  });

  it('renders noul=2.0 (above 1) as YES at 200.0%', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 2.0 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQ() },
      }),
      client,
    )) as SuccessResult;
    // 2.0 is finite, 2.0 >= 0.5 → YES
    expect(r.content[0].text).toContain('YES');
    expect(r.content[0].text).toContain('200.0%');
  });
});

describe('handleDecide — score with all identical values (tie)', () => {
  it('picks first level (index 0) when all scores are equal', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.25, 0.25, 0.25, 0.25] } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['bad', 'ok', 'good', 'great'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    // Loop finds first max at index 0 (0.25 > -Infinity), doesn't update after
    expect(r.content[0].text).toContain('level 1/4');
    expect(r.content[0].text).toContain('25.0%');
  });
});

describe('handleDecide — noul with boolean value (non-number)', () => {
  it('treats noul=true (typeof boolean !== number) as P=0 → NO', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: true } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: { q1: noulQ() },
      }),
      client,
    )) as SuccessResult;
    // typeof true !== 'number' → prob defaults to 0
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

describe('handleDecide — answer value is primitive number', () => {
  it('skips numeric answer values in summary (defensive continue)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: 42, // not an object — should be skipped
        q2: { type: 'noul', noul: 0.8 },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ('question one'),
          q2: noulQ('question two'),
        },
      }),
      client,
    )) as SuccessResult;
    const lines = r.content[0].text.split('\n').filter((l: string) => l.trim());
    // q1 (number) is skipped, only q2 should appear
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('q2');
    expect(lines[0]).toContain('YES');
  });
});

// ---------------------------------------------------------------------------
// 9–11. embed_text — response model fallback edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — response.model falsy non-string values', () => {
  it('falls back to effectiveModel when response.model is 0', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: 0, // falsy non-string
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as SuccessResult;
    // `response.model || effectiveModel` — 0 is falsy, falls back
    expect(r.structuredContent.model).toBe('openai/text-embedding-3-small');
    expect(r._meta.model).toBe('openai/text-embedding-3-small');
  });

  it('falls back to effectiveModel when response.model is false', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: false, // falsy non-string
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'test', model: 'voyage/voyage-3' }),
      client,
    )) as SuccessResult;
    expect(r.structuredContent.model).toBe('voyage/voyage-3');
    expect(r._meta.model).toBe('voyage/voyage-3');
  });
});

describe('handleEmbedText — response.usage is null (not undefined)', () => {
  it('omits usage from _meta when response.usage is null', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
      usage: null,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'test' }), client)) as SuccessResult;
    // `response.usage ? { usage: ... } : {}` — null is falsy
    expect(r._meta.usage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 12–16. classifyUpstreamError — remaining context-length and edge cases
// ---------------------------------------------------------------------------

describe('classifyUpstreamError — "exceeds the model" context-length', () => {
  it('maps "exceeds the model" to INVALID_INPUT with context_length reason', () => {
    const err = new Error('This request exceeds the model maximum input length of 128000 tokens');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.details?.reason).toBe('context_length');
  });
});

describe('classifyUpstreamError — "too large" without 413 status', () => {
  it('maps "too large" message text to RESOURCE_TOO_LARGE without status', () => {
    const err = new Error('Payload too large for this model endpoint');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('RESOURCE_TOO_LARGE');
    expect(r._meta.suggestions).toBeDefined();
  });
});

describe('classifyUpstreamError — non-parseable Retry-After header', () => {
  it('returns undefined retry_after_seconds for non-parseable Retry-After', () => {
    const err = {
      status: 429,
      message: 'rate limit exceeded',
      headers: { 'retry-after': 'invalid-value' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    // 'invalid-value' is not a number and not a date → retry_after_seconds undefined
    expect(r._meta.retry_after_seconds).toBeUndefined();
  });
});

describe('classifyUpstreamError — nested string error extraction', () => {
  it('appends nested string error to message for Error instances', () => {
    const err = Object.assign(new Error('Request failed'), {
      error: 'Detailed: model overloaded',
    });
    const r = classifyUpstreamError(err);
    // extractMessage: `${err.message} — ${nested}` (nested is a string)
    expect(r.content[0].text).toContain('Request failed');
    expect(r.content[0].text).toContain('Detailed: model overloaded');
  });
});

describe('classifyUpstreamError — object without message or error field', () => {
  it('returns "unknown error" for object with only unrelated fields', () => {
    const err = { status: 500, data: 'irrelevant', extra: true };
    const r = classifyUpstreamError(err);
    expect(r.content[0].text).toContain('unknown error');
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details).toEqual({ status: 500 });
  });
});

// ---------------------------------------------------------------------------
// 17–22. completion-utils edge cases
// ---------------------------------------------------------------------------

describe('extractCompletionText — choices undefined', () => {
  it('returns empty text when choices property is undefined', () => {
    const r = extractCompletionText({ choices: undefined } as unknown as ChatCompletion);
    expect(r.text).toBe('');
    expect(r.reasonedOnly).toBe(false);
    expect(r.finishReason).toBeUndefined();
  });
});

describe('extractCompletionText — content is null with no reasoning', () => {
  it('returns empty string when content is null and no reasoning exists', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: { content: null, role: 'assistant' },
          finish_reason: 'stop',
        },
      ],
    } as unknown as ChatCompletion);
    expect(r.text).toBe('');
    expect(r.reasonedOnly).toBe(false);
    expect(r.finishReason).toBe('stop');
  });
});

describe('capResultText — limit disabled with env=0', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does not truncate any length when OPENROUTER_MAX_RESULT_TEXT_CHARS=0', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '0');
    const longText = 'x'.repeat(1_000_000);
    const r = capResultText(longText);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe(longText);
  });
});

describe('buildCompletionMeta — reasoning=undefined with includeReasoning=true', () => {
  it('omits reasoning key when extracted.reasoning is undefined', () => {
    const e: ExtractedText = {
      text: 'answer',
      reasonedOnly: false,
      finishReason: 'stop',
      nativeFinishReason: undefined,
      reasoning: undefined,
    };
    const m = buildCompletionMeta(e, { includeReasoning: true });
    expect(m).not.toHaveProperty('reasoning');
    expect(m).not.toHaveProperty('reasoning_truncated');
  });
});

describe('classifyEmptyCompletion — null finish_reason', () => {
  it('treats null finish_reason as default branch (INTERNAL)', () => {
    const e: ExtractedText = {
      text: '',
      reasonedOnly: false,
      finishReason: null as unknown as undefined,
      nativeFinishReason: undefined,
    };
    const r = classifyEmptyCompletion(e, 'Chat');
    // null doesn't match any switch case → default → INTERNAL
    expect(r._meta.code).toBe(ErrorCode.INTERNAL);
    expect(r.content[0].text).toContain('no textual content');
  });
});

describe('readMaxResultTextChars — float value', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('parses "1.5" via parseInt as 1 (valid positive integer)', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '1.5');
    // parseInt('1.5', 10) = 1; isFinite(1) && 1 > 0 → returns 1
    expect(readMaxResultTextChars()).toBe(1);
  });

  it('parses "0.5" via parseInt as 0 (not > 0) → defaults', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '0.5');
    // parseInt('0.5', 10) = 0; 0 is not > 0, but '0.5' !== '0' so it
    // doesn't hit the early return. The isFinite(0) && 0 > 0 is false → default.
    expect(readMaxResultTextChars()).toBe(512_000);
  });
});

// ---------------------------------------------------------------------------
// Additional: toolError with combined opts
// ---------------------------------------------------------------------------

describe('toolError — combined details and opts', () => {
  it('carries both details and suggestions together', () => {
    const r = toolError(
      ErrorCode.UPSTREAM_REFUSED,
      'rate limited',
      { status: 429, reason: 'rate_limit' },
      { suggestions: ['Wait 30s', 'Try :nitro suffix'], retry_after_seconds: 30 },
    );
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details).toEqual({ status: 429, reason: 'rate_limit' });
    expect(r._meta.suggestions).toEqual(['Wait 30s', 'Try :nitro suffix']);
    expect(r._meta.retry_after_seconds).toBe(30);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe('rate limited');
  });

  it('omits suggestions when opts is undefined', () => {
    const r = toolError(ErrorCode.INTERNAL, 'something broke', { key: 'val' });
    expect(r._meta.suggestions).toBeUndefined();
    expect(r._meta.retry_after_seconds).toBeUndefined();
    expect(r._meta.details).toEqual({ key: 'val' });
  });
});

// ---------------------------------------------------------------------------
// Additional: decide — response.usage is null
// ---------------------------------------------------------------------------

describe('handleDecide — response.usage null omission', () => {
  it('omits usage from _meta when response.usage is null', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.7 } },
      usage: null,
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;
    // `response.usage ? { usage: ... } : {}` — null is falsy
    expect(r._meta.usage).toBeUndefined();
  });
});
