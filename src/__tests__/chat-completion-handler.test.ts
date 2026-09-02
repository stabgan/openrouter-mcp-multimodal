import { describe, it, expect, vi, afterEach } from 'vitest';
import OpenAI from 'openai';
import { handleChatCompletion } from '../tool-handlers/chat-completion.js';
import { ErrorCode } from '../errors.js';
import { DEFAULT_CHAT_MODEL } from '../tool-handlers/chat-request.js';
import {
  extractCompletionText,
  buildCompletionMeta,
  capResultText,
  readMaxResultTextChars,
} from '../tool-handlers/completion-utils.js';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';

function mockOpenAI(
  response: unknown,
  throws?: unknown,
): { openai: OpenAI; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  if (throws) create.mockRejectedValue(throws);
  else create.mockResolvedValue(response);
  const openai = { chat: { completions: { create } } } as unknown as OpenAI;
  return { openai, create };
}

describe('handleChatCompletion', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('rejects empty messages before calling OpenAI', async () => {
    const { openai, create } = mockOpenAI({});
    const r = await handleChatCompletion({ params: { arguments: { messages: [] } } }, openai);
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects invalid max_tokens before calling OpenAI', async () => {
    const { openai, create } = mockOpenAI({});
    const r = await handleChatCompletion(
      {
        params: {
          arguments: { messages: [{ role: 'user', content: 'hi' }], max_tokens: 0 },
        },
      },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(create).not.toHaveBeenCalled();
  });

  it('uses OPENROUTER_MAX_TOKENS env default when max_tokens is omitted', async () => {
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '4096');
    const { openai, create } = mockOpenAI({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
    await handleChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 4096 }), undefined);
  });

  it('uses DEFAULT_CHAT_MODEL when model is omitted', async () => {
    const { openai, create } = mockOpenAI({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
    await handleChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: DEFAULT_CHAT_MODEL, temperature: 1 }),
      undefined,
    );
  });

  it('honors explicit defaultModel parameter over DEFAULT_CHAT_MODEL', async () => {
    const { openai, create } = mockOpenAI({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
    await handleChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
      'custom/default',
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'custom/default' }),
      undefined,
    );
  });

  it('passes cache headers as second argument when cache is enabled', async () => {
    const { openai, create } = mockOpenAI({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
    await handleChatCompletion(
      {
        params: {
          arguments: {
            messages: [{ role: 'user', content: 'hi' }],
            cache: true,
            cache_ttl: '1h',
          },
        },
      },
      openai,
    );
    expect(create).toHaveBeenCalledWith(expect.any(Object), {
      headers: {
        'X-OpenRouter-Cache': 'true',
        'X-OpenRouter-Cache-TTL': '3600',
      },
    });
  });

  it('includes online web plugin in request body', async () => {
    const { openai, create } = mockOpenAI({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
    await handleChatCompletion(
      {
        params: {
          arguments: {
            messages: [{ role: 'user', content: 'news?' }],
            online: true,
            web_max_results: 3,
          },
        },
      },
      openai,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: [{ id: 'web', max_results: 3 }],
      }),
      undefined,
    );
  });

  it('returns completion text and usage metadata on success', async () => {
    const { openai } = mockOpenAI({
      choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
    });
    const r = await handleChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    expect(r.isError).toBeUndefined();
    expect(r.content).toEqual([{ type: 'text', text: 'Hello world' }]);
    expect((r as { _meta: { usage: { total_tokens: number } } })._meta.usage?.total_tokens).toBe(
      12,
    );
  });

  it('returns INTERNAL when model returns no textual content', async () => {
    const { openai } = mockOpenAI({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
    });
    const r = await handleChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INTERNAL);
  });

  it('classifies upstream 429 as UPSTREAM_REFUSED with retry_after_seconds', async () => {
    const rateLimitErr = Object.assign(new Error('Rate limit exceeded'), {
      status: 429,
      headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '45' : null) },
    });
    const { openai } = mockOpenAI({}, rateLimitErr);
    const r = await handleChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string; retry_after_seconds?: number } })._meta.code).toBe(
      ErrorCode.UPSTREAM_REFUSED,
    );
    expect((r as { _meta: { retry_after_seconds?: number } })._meta.retry_after_seconds).toBe(45);
  });

  it('supports multimodal message arrays in the request body', async () => {
    const { openai, create } = mockOpenAI({
      choices: [{ message: { content: 'I see a cat' }, finish_reason: 'stop' }],
    });
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'describe' },
          { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,abc' } },
        ],
      },
    ];
    await handleChatCompletion({ params: { arguments: { messages } } }, openai);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ messages }), undefined);
  });

  it('rejects null message content', async () => {
    const { openai, create } = mockOpenAI({});
    const r = await handleChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: null }] } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects empty message role', async () => {
    const { openai, create } = mockOpenAI({});
    const r = await handleChatCompletion(
      { params: { arguments: { messages: [{ role: '  ' as 'user', content: 'hi' }] } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(create).not.toHaveBeenCalled();
  });

  it('truncates oversized completion text when env cap is set', async () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '10');
    const { openai } = mockOpenAI({
      choices: [{ message: { content: '012345678901234567890' }, finish_reason: 'stop' }],
    });
    const r = await handleChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
    );
    expect(r.isError).toBeUndefined();
    const text = (r as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text.startsWith('0123456789')).toBe(true);
    expect(text).toContain('truncated');
    expect((r as { _meta: { result_truncated?: boolean } })._meta.result_truncated).toBe(true);
  });
});

describe('extractCompletionText', () => {
  it('returns empty text when choices are missing', () => {
    expect(extractCompletionText({} as ChatCompletion).text).toBe('');
  });

  it('returns empty text when choices array is empty', () => {
    expect(extractCompletionText({ choices: [] } as ChatCompletion).text).toBe('');
  });

  it('extracts string content from the first choice only', () => {
    const r = extractCompletionText({
      choices: [
        { message: { content: 'first' }, finish_reason: 'stop' },
        { message: { content: 'second' }, finish_reason: 'stop' },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('first');
  });

  it('extracts refusal text when content is absent', () => {
    const r = extractCompletionText({
      choices: [{ message: { refusal: 'I cannot help with that.' }, finish_reason: 'stop' }],
    } as ChatCompletion);
    expect(r.text).toBe('I cannot help with that.');
  });

  it('returns empty text for tool-call-only assistant messages', () => {
    const r = extractCompletionText({
      choices: [
        {
          message: { role: 'assistant', tool_calls: [{ id: '1', type: 'function', function: {} }] },
          finish_reason: 'tool_calls',
        },
      ],
    } as ChatCompletion);
    expect(r.text).toBe('');
  });

  it('does not throw on malformed completion payloads', () => {
    expect(() => extractCompletionText(null as unknown as ChatCompletion)).not.toThrow();
    expect(extractCompletionText(null as unknown as ChatCompletion).text).toBe('');
  });

  it('handles missing usage gracefully', () => {
    const r = extractCompletionText({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    } as ChatCompletion);
    expect(r.usage).toBeUndefined();
    expect(buildCompletionMeta(r)).not.toHaveProperty('usage');
  });
});

describe('capResultText', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('passes through text when under the cap', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '100');
    expect(capResultText('hello').truncated).toBe(false);
  });

  it('disables capping when env is 0', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '0');
    const long = 'x'.repeat(1000);
    expect(capResultText(long)).toEqual({ text: long, truncated: false });
  });

  it('defaults to a positive cap', () => {
    vi.unstubAllEnvs();
    expect(readMaxResultTextChars()).toBeGreaterThan(0);
  });
});
