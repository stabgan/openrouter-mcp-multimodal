import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import {
  classifyEmptyCompletion,
  detectReasoningCutoff,
  toUsageMeta,
  buildCompletionMeta,
  extractCompletionText,
  readMaxResultTextChars,
  capResultText,
  type ExtractedText,
} from '../tool-handlers/completion-utils.js';
import { ErrorCode } from '../errors.js';

describe('classifyEmptyCompletion', () => {
  const base: ExtractedText = {
    text: '',
    reasonedOnly: false,
    finishReason: undefined,
    nativeFinishReason: undefined,
  };

  it('returns UPSTREAM_REFUSED for content_filter', () => {
    const r = classifyEmptyCompletion({ ...base, finishReason: 'content_filter' }, 'Chat');
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.UPSTREAM_REFUSED);
    expect(r.content[0].text).toContain('content filter');
    expect(r._meta.suggestions).toBeDefined();
  });

  it('returns INVALID_INPUT for length', () => {
    const r = classifyEmptyCompletion({ ...base, finishReason: 'length' }, 'Chat');
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('max_tokens');
  });

  it('returns INVALID_INPUT for tool_calls', () => {
    const r = classifyEmptyCompletion({ ...base, finishReason: 'tool_calls' }, 'Chat');
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('tool calls');
  });

  it('returns INVALID_INPUT for function_call', () => {
    const r = classifyEmptyCompletion({ ...base, finishReason: 'function_call' }, 'Chat');
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('tool calls');
  });

  it('returns INTERNAL for stop (default branch)', () => {
    const r = classifyEmptyCompletion({ ...base, finishReason: 'stop' }, 'Analyze');
    expect(r._meta.code).toBe(ErrorCode.INTERNAL);
    expect(r.content[0].text).toContain('no textual content');
  });

  it('returns INTERNAL for undefined finish_reason', () => {
    const r = classifyEmptyCompletion(base, 'Chat');
    expect(r._meta.code).toBe(ErrorCode.INTERNAL);
  });

  it('includes native_finish_reason in details when present', () => {
    const r = classifyEmptyCompletion(
      { ...base, finishReason: 'content_filter', nativeFinishReason: 'safety' },
      'Chat',
    );
    expect(r._meta.details?.native_finish_reason).toBe('safety');
  });

  it('omits native_finish_reason when absent', () => {
    const r = classifyEmptyCompletion({ ...base, finishReason: 'length' }, 'Chat');
    expect(r._meta.details).not.toHaveProperty('native_finish_reason');
  });

  it('uses the label in the error message', () => {
    const r = classifyEmptyCompletion({ ...base, finishReason: 'stop' }, 'analyze_audio');
    expect(r.content[0].text).toContain('analyze_audio');
  });
});

describe('detectReasoningCutoff', () => {
  it('returns null when not reasoning-only', () => {
    const e: ExtractedText = {
      text: 'answer',
      reasonedOnly: false,
      finishReason: 'length',
      nativeFinishReason: undefined,
    };
    expect(detectReasoningCutoff(e)).toBeNull();
  });

  it('returns null when reasoning-only but finish_reason is stop', () => {
    const e: ExtractedText = {
      text: 'thinking',
      reasonedOnly: true,
      finishReason: 'stop',
      nativeFinishReason: undefined,
    };
    expect(detectReasoningCutoff(e)).toBeNull();
  });

  it('returns error when reasoning-only and finish_reason is length', () => {
    const e: ExtractedText = {
      text: 'deep thinking',
      reasonedOnly: true,
      finishReason: 'length',
      nativeFinishReason: undefined,
      usage: { prompt_tokens: 10, completion_tokens: 500, total_tokens: 510 },
    };
    const r = detectReasoningCutoff(e);
    expect(r).not.toBeNull();
    expect(r!._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r!.content[0].text).toContain('max_tokens');
    expect(r!._meta.details?.usage).toBeDefined();
  });

  it('truncates reasoning preview to 200 chars', () => {
    const e: ExtractedText = {
      text: 'x'.repeat(300),
      reasonedOnly: true,
      finishReason: 'length',
      nativeFinishReason: undefined,
    };
    const r = detectReasoningCutoff(e)!;
    expect((r._meta.details?.reasoning_preview as string).length).toBe(200);
  });

  it('omits usage when not present', () => {
    const e: ExtractedText = {
      text: 'thinking',
      reasonedOnly: true,
      finishReason: 'length',
      nativeFinishReason: undefined,
    };
    const r = detectReasoningCutoff(e)!;
    expect(r._meta.details?.usage).toBeUndefined();
  });
});

describe('toUsageMeta', () => {
  it('returns undefined when usage is undefined', () => {
    expect(toUsageMeta(undefined)).toBeUndefined();
  });

  it('wraps usage in envelope', () => {
    const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
    expect(toUsageMeta(usage)).toEqual({
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  });
});

describe('buildCompletionMeta coverage', () => {
  const base: ExtractedText = {
    text: 'hello',
    reasonedOnly: false,
    finishReason: 'stop',
    nativeFinishReason: undefined,
  };

  it('includes finish_reason', () => {
    expect(buildCompletionMeta(base).finish_reason).toBe('stop');
  });

  it('includes native_finish_reason when present', () => {
    const m = buildCompletionMeta({ ...base, nativeFinishReason: 'end_turn' });
    expect(m.native_finish_reason).toBe('end_turn');
  });

  it('omits native_finish_reason when absent', () => {
    expect(buildCompletionMeta(base)).not.toHaveProperty('native_finish_reason');
  });

  it('includes reasoning when includeReasoning is true', () => {
    const e: ExtractedText = { ...base, reasoning: 'I thought carefully' };
    const m = buildCompletionMeta(e, { includeReasoning: true });
    expect(m.reasoning).toBe('I thought carefully');
  });

  it('omits reasoning when includeReasoning is false', () => {
    const e: ExtractedText = { ...base, reasoning: 'hidden' };
    const m = buildCompletionMeta(e, { includeReasoning: false });
    expect(m).not.toHaveProperty('reasoning');
  });

  it('omits reasoning when reasonedOnly is true', () => {
    const e: ExtractedText = { ...base, reasonedOnly: true, reasoning: 'trace' };
    const m = buildCompletionMeta(e, { includeReasoning: true });
    expect(m).not.toHaveProperty('reasoning');
  });

  it('truncates long reasoning and sets flag', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '20');
    const e: ExtractedText = { ...base, reasoning: 'x'.repeat(100) };
    const m = buildCompletionMeta(e, { includeReasoning: true });
    expect(m.reasoning_truncated).toBe(true);
    expect((m.reasoning as string).startsWith('x'.repeat(20))).toBe(true);
    vi.unstubAllEnvs();
  });

  it('merges usage into meta', () => {
    const e: ExtractedText = {
      ...base,
      usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
    };
    const m = buildCompletionMeta(e);
    expect(m.usage).toEqual({ prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 });
  });

  it('merges extra fields into meta', () => {
    const m = buildCompletionMeta(base, { extra: { model: 'gpt-4', cached: true } });
    expect(m.model).toBe('gpt-4');
    expect(m.cached).toBe(true);
  });
});

describe('extractCompletionText reasoning paths', () => {
  it('returns reasoning as text when content is empty', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: { content: '', reasoning: 'I need to think' } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('I need to think');
    expect(r.reasonedOnly).toBe(true);
    expect(r.reasoning).toBe('I need to think');
  });

  it('extracts reasoning from reasoning_details array', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: '',
            reasoning_details: [
              { type: 'text', text: 'Step 1' },
              { type: 'text', text: 'Step 2' },
            ],
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.reasonedOnly).toBe(true);
    expect(r.text).toContain('Step 1');
  });

  it('prefers content over reasoning', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: { content: 'Final answer', reasoning: 'Thinking' } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('Final answer');
    expect(r.reasonedOnly).toBe(false);
    expect(r.reasoning).toBe('Thinking');
  });

  it('handles content as multipart array', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'Part A ' },
              { type: 'text', text: 'Part B' },
            ],
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('Part A Part B');
  });

  it('ignores non-text parts in multipart content', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'hello' },
              { type: 'image_url', url: 'http://x.com/a.png' },
            ],
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('hello');
  });

  it('extracts native_finish_reason from choice', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: { content: 'ok' },
          finish_reason: 'stop',
          native_finish_reason: 'end_turn',
        } as unknown,
      ],
    } as ChatCompletion);
    expect(r.nativeFinishReason).toBe('end_turn');
  });

  it('handles reasoning_details with non-text entries', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: {
            content: '',
            reasoning_details: [
              { type: 'redacted', text: undefined },
              { type: 'text', text: 'actual thought' },
            ],
          } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('actual thought');
    expect(r.reasonedOnly).toBe(true);
  });

  it('returns empty when reasoning_details is empty', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: { content: '', reasoning_details: [] } as unknown,
          finish_reason: 'stop',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('');
    expect(r.reasonedOnly).toBe(false);
  });

  it('extracts usage from completion', () => {
    const r = extractCompletionText({
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    } as ChatCompletion);
    expect(r.usage).toEqual({ prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 });
  });
});

describe('readMaxResultTextChars edge cases', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns default for non-numeric env', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', 'abc');
    expect(readMaxResultTextChars()).toBe(512_000);
  });

  it('returns default for negative env', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '-5');
    expect(readMaxResultTextChars()).toBe(512_000);
  });

  it('returns 0 when env is 0', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '0');
    expect(readMaxResultTextChars()).toBe(0);
  });

  it('returns custom value', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '1024');
    expect(readMaxResultTextChars()).toBe(1024);
  });

  it('returns default for empty', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '');
    expect(readMaxResultTextChars()).toBe(512_000);
  });
});

describe('capResultText boundary', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does not truncate at exactly the cap', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '10');
    const r = capResultText('1234567890');
    expect(r.truncated).toBe(false);
    expect(r.text).toBe('1234567890');
  });

  it('truncates one char over the cap', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '10');
    const r = capResultText('12345678901');
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('truncated');
  });
});
