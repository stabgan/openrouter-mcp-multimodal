import { describe, it, expect } from 'vitest';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import {
  extractCompletionText,
  detectReasoningCutoff,
  toUsageMeta,
} from '../tool-handlers/completion-utils.js';

function toCompletion(partial: Partial<ChatCompletion>): ChatCompletion {
  return partial as ChatCompletion;
}

describe('extractCompletionText', () => {
  it('returns plain string content', () => {
    const completion = toCompletion({
      choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    expect(extractCompletionText(completion)).toEqual({
      text: 'Hello world',
      reasonedOnly: false,
      finishReason: 'stop',
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
  });

  it('concatenates text parts from array content', () => {
    const completion = toCompletion({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
              { type: 'text', text: 'there' },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    });
    const extracted = extractCompletionText(completion);
    expect(extracted.text).toBe('Hello there');
    expect(extracted.reasonedOnly).toBe(false);
  });

  it('falls back to reasoning when content is empty', () => {
    const completion = toCompletion({
      choices: [{ message: { content: null, reasoning: 'Thinking...' }, finish_reason: 'stop' }],
    });
    const extracted = extractCompletionText(completion);
    expect(extracted.text).toBe('Thinking...');
    expect(extracted.reasonedOnly).toBe(true);
  });

  it('falls back to reasoning_details when reasoning is missing', () => {
    const completion = toCompletion({
      choices: [
        {
          message: {
            content: null,
            reasoning_details: [{ type: 'text', text: 'Part A' }, { type: 'text', text: 'Part B' }],
          },
          finish_reason: 'stop',
        },
      ],
    });
    const extracted = extractCompletionText(completion);
    expect(extracted.text).toBe('Part A\nPart B');
    expect(extracted.reasonedOnly).toBe(true);
  });
});

describe('detectReasoningCutoff', () => {
  it('returns INVALID_INPUT for truncated reasoning-only responses', () => {
    const completion = toCompletion({
      choices: [{ message: { content: null, reasoning: 'Long thoughts' }, finish_reason: 'length' }],
    });
    const extracted = extractCompletionText(completion);
    const cutoff = detectReasoningCutoff(extracted);
    expect(cutoff?.isError).toBe(true);
    expect(cutoff?._meta.code).toBe('INVALID_INPUT');
  });

  it('returns null for non-truncated responses', () => {
    const completion = toCompletion({
      choices: [{ message: { content: 'Done' }, finish_reason: 'stop' }],
    });
    const extracted = extractCompletionText(completion);
    expect(detectReasoningCutoff(extracted)).toBeNull();
  });
});

describe('toUsageMeta', () => {
  it('returns undefined when usage is missing', () => {
    expect(toUsageMeta(undefined)).toBeUndefined();
  });

  it('maps token counts into a usage object', () => {
    expect(
      toUsageMeta({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
    ).toEqual({
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });
});
