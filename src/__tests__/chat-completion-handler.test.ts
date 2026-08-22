import { describe, it, expect, vi, afterEach } from 'vitest';
import OpenAI from 'openai';
import { handleChatCompletion } from '../tool-handlers/chat-completion.js';
import { ErrorCode } from '../errors.js';
import { DEFAULT_CHAT_MODEL } from '../tool-handlers/chat-request.js';

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
        'X-OpenRouter-Cache-TTL': '1h',
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
});
