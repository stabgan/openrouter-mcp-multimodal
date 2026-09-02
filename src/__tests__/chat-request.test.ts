import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildChatCompletionBody,
  buildChatCompletionRequestOpts,
  readIncludeReasoningDefault,
  asOpenAIChatBody,
  validateChatMessages,
  validateMaxTokens,
} from '../tool-handlers/chat-request.js';
import { ErrorCode } from '../errors.js';

describe('validateChatMessages', () => {
  it('rejects empty messages array', () => {
    const r = validateChatMessages([]);
    expect(r?.isError).toBe(true);
    expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('rejects messages with empty role', () => {
    const r = validateChatMessages([{ role: '  ' as 'user', content: 'hi' }]);
    expect(r?.isError).toBe(true);
    expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r?.content[0]?.text).toContain('index 0');
  });

  it('rejects messages with null content', () => {
    const r = validateChatMessages([{ role: 'user', content: null }]);
    expect(r?.isError).toBe(true);
    expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r?.content[0]?.text).toContain('null content');
  });

  it('accepts assistant messages without content (tool-call turns)', () => {
    expect(
      validateChatMessages([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: undefined, tool_calls: [] },
      ]),
    ).toBeNull();
  });
});

describe('readIncludeReasoningDefault', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['1', 'true', 'TRUE', 'yes', 'Yes'])('accepts truthy %s', (v) => {
    vi.stubEnv('OPENROUTER_INCLUDE_REASONING', v);
    expect(readIncludeReasoningDefault()).toBe(true);
  });

  it.each(['0', 'false', 'no', '', 'nonsense'])('rejects non-truthy %s', (v) => {
    vi.stubEnv('OPENROUTER_INCLUDE_REASONING', v);
    expect(readIncludeReasoningDefault()).toBe(false);
  });

  it('defaults to false when unset', () => {
    vi.stubEnv('OPENROUTER_INCLUDE_REASONING', '');
    expect(readIncludeReasoningDefault()).toBe(false);
  });
});

describe('validateMaxTokens', () => {
  it('accepts undefined max_tokens', () => {
    expect(validateMaxTokens(undefined)).toBeNull();
  });

  it('accepts positive integers', () => {
    expect(validateMaxTokens(512)).toBeNull();
  });

  it('rejects zero, negative, and non-finite values', () => {
    for (const bad of [0, -1, NaN, Infinity, 1.5]) {
      const r = validateMaxTokens(bad);
      expect(r?.isError).toBe(true);
      expect(r?._meta.code).toBe(ErrorCode.INVALID_INPUT);
    }
  });
});

describe('buildChatCompletionBody', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('builds a minimal body with defaults', () => {
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body).toEqual({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 1,
    });
  });

  it('includes max_tokens when resolved from request', () => {
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 512,
    });
    expect(body.max_tokens).toBe(512);
  });

  it('omits max_tokens when unset and env default is absent', () => {
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '');
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('uses env default max_tokens when request omits it', () => {
    vi.stubEnv('OPENROUTER_MAX_TOKENS', '4096');
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body.max_tokens).toBe(4096);
  });

  it('respects explicit temperature', () => {
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
    });
    expect(body.temperature).toBe(0.2);
  });

  it('includes include_reasoning when explicitly true', () => {
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      include_reasoning: true,
    });
    expect(body.include_reasoning).toBe(true);
  });

  it('omits include_reasoning when false and env default is off', () => {
    vi.stubEnv('OPENROUTER_INCLUDE_REASONING', '');
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      include_reasoning: false,
    });
    expect(body).not.toHaveProperty('include_reasoning');
  });

  it('honors env default for include_reasoning when not overridden', () => {
    vi.stubEnv('OPENROUTER_INCLUDE_REASONING', '1');
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body.include_reasoning).toBe(true);
  });

  it('merges provider routing from env and request overrides', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_SORT', 'price');
    vi.stubEnv('OPENROUTER_PROVIDER_IGNORE', 'openai');
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      provider: { sort: 'latency' },
    });
    expect(body.provider).toEqual({ sort: 'latency', ignore: ['openai'] });
  });

  it('adds web plugin when online=true', () => {
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      online: true,
    });
    expect(body.plugins).toEqual([{ id: 'web' }]);
  });

  it('adds web_max_results to plugin when positive', () => {
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      online: true,
      web_max_results: 5,
    });
    expect(body.plugins).toEqual([{ id: 'web', max_results: 5 }]);
  });

  it('ignores non-positive web_max_results', () => {
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      online: true,
      web_max_results: 0,
    });
    expect(body.plugins).toEqual([{ id: 'web' }]);
  });

  it('ignores negative web_max_results', () => {
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      online: true,
      web_max_results: -5,
    });
    expect(body.plugins).toEqual([{ id: 'web' }]);
  });

  it('explicit include_reasoning:false overrides env default on', () => {
    vi.stubEnv('OPENROUTER_INCLUDE_REASONING', '1');
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
      include_reasoning: false,
    });
    expect(body).not.toHaveProperty('include_reasoning');
  });

  it('omits provider key when no env defaults and no request provider', () => {
    vi.stubEnv('OPENROUTER_PROVIDER_SORT', '');
    vi.stubEnv('OPENROUTER_PROVIDER_IGNORE', '');
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body).not.toHaveProperty('provider');
  });

  it('preserves multimodal message content in body', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'look' },
          { type: 'image_url' as const, image_url: { url: 'https://example.com/x.png' } },
        ],
      },
    ];
    const body = buildChatCompletionBody({
      model: 'test/model',
      messages,
    });
    expect(body.messages).toEqual(messages);
  });
});

describe('buildChatCompletionRequestOpts', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns undefined when no cache headers apply', () => {
    expect(buildChatCompletionRequestOpts({})).toBeUndefined();
    expect(buildChatCompletionRequestOpts(undefined as never)).toBeUndefined();
  });

  it('returns headers wrapper when cache is enabled', () => {
    expect(buildChatCompletionRequestOpts({ cache: true })).toEqual({
      headers: { 'X-OpenRouter-Cache': 'true' },
    });
  });

  it('includes cache_ttl and cache_clear headers', () => {
    expect(
      buildChatCompletionRequestOpts({ cache: true, cache_ttl: '15m', cache_clear: true }),
    ).toEqual({
      headers: {
        'X-OpenRouter-Cache': 'true',
        'X-OpenRouter-Cache-TTL': '900',
        'X-OpenRouter-Cache-Clear': 'true',
      },
    });
  });

  it('honors env-driven cache default', () => {
    vi.stubEnv('OPENROUTER_CACHE_RESPONSES', '1');
    expect(buildChatCompletionRequestOpts({})).toEqual({
      headers: { 'X-OpenRouter-Cache': 'true' },
    });
  });
});

describe('asOpenAIChatBody', () => {
  it('returns the same object reference (cast helper)', () => {
    const body = { model: 'x', messages: [] };
    expect(asOpenAIChatBody(body)).toBe(body);
  });
});
