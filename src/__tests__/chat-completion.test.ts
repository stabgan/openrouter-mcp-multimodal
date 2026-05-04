import { describe, it, expect, vi, afterEach } from 'vitest';
import type OpenAI from 'openai';
import { handleChatCompletion } from '../tool-handlers/chat-completion.js';

function mockOpenAI(response: unknown) {
  const create = vi.fn().mockResolvedValue(response);
  const openai = { chat: { completions: { create } } } as unknown as OpenAI;
  return { openai, create };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('handleChatCompletion', () => {
  it('rejects empty message arrays', async () => {
    const { openai } = mockOpenAI({});
    const r = await handleChatCompletion(
      { params: { arguments: { messages: [] } } },
      openai,
      'default/model',
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('builds provider body and attaches usage metadata', async () => {
    vi.stubEnv('OPENROUTER_PROVIDER_SORT', 'price');
    vi.stubEnv('OPENROUTER_PROVIDER_IGNORE', 'openai');
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '256');

    const { openai, create } = mockOpenAI({
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    });

    const r = await handleChatCompletion(
      {
        params: {
          arguments: {
            messages: [{ role: 'user', content: 'hello' }],
            provider: { allow_fallbacks: false },
          },
        },
      },
      openai,
      'default/model',
    );

    expect(r.isError).toBeFalsy();
    const call = create.mock.calls[0]![0];
    expect(call.model).toBe('default/model');
    expect(call.max_tokens).toBe(256);
    expect(call.provider).toEqual({ sort: 'price', ignore: ['openai'], allow_fallbacks: false });
    expect((r as { _meta?: { usage?: unknown } })._meta?.usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
    });
  });

  it('returns INVALID_INPUT when reasoning is truncated', async () => {
    const { openai } = mockOpenAI({
      choices: [{ message: { content: null, reasoning: 'thinking' }, finish_reason: 'length' }],
    });
    const r = await handleChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
      'default/model',
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('maps upstream errors via classifyUpstreamError', async () => {
    const create = vi.fn().mockRejectedValue(new Error('rate limit exceeded'));
    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    const r = await handleChatCompletion(
      { params: { arguments: { messages: [{ role: 'user', content: 'hi' }] } } },
      openai,
      'default/model',
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UPSTREAM_REFUSED');
  });
});
