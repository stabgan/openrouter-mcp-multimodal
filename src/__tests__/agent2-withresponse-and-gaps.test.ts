/**
 * Agent 2 — Coverage for awaitCompletionWithHeaders (zero prior coverage)
 * and remaining edge-case gaps in embed_text, decide, and buildStructuredResult.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets:
 *
 * awaitCompletionWithHeaders (openai-withresponse.ts):
 *  1. withResponse path — call object has .withResponse(), uses it
 *  2. fallback path — call is a plain Promise, awaits directly
 *  3. withResponse returns data + response Headers
 *  4. fallback path returns response: undefined
 *  5. withResponse is not a function (number, string, etc.) — fallback
 *  6. call is null-ish but has no .withResponse — throws (natural TypeError)
 *
 * buildStructuredResult (structured-output.ts):
 *  7. meta is merged with server_version
 *  8. default meta is empty — only server_version present
 *  9. data with nested objects produces correct JSON text
 *  10. data with arrays
 *
 * readToolPayload (structured-output.ts):
 *  11. prefers structuredContent over content text
 *  12. falls back to content text when structuredContent is undefined
 *  13. throws when neither structuredContent nor content text is present
 *  14. throws on invalid JSON in content text
 *
 * embed_text — remaining gap:
 *  15. verify dimensions=undefined is omitted from API call (explicit undefined check)
 *  16. model with surrounding whitespace AND response.model falsy — verify trimmed fallback
 *
 * decide — remaining gap:
 *  17. state=undefined is accepted (not validated) and not passed to API
 *  18. noul with noul=-0 — edge: typeof check passes, isFinite true, -0 < 0.5 → NO
 *  19. score answer where maxVal is updated multiple times (verifies loop correctness)
 *  20. choice answer where values include negative probabilities
 */
import { describe, it, expect, vi } from 'vitest';
import { awaitCompletionWithHeaders } from '../tool-handlers/openai-withresponse.js';
import { buildStructuredResult, readToolPayload } from '../tool-handlers/structured-output.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import { SERVER_VERSION } from '../version.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  return {
    submitDecision: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

// ---------------------------------------------------------------------------
// 1–6. awaitCompletionWithHeaders
// ---------------------------------------------------------------------------

describe('awaitCompletionWithHeaders', () => {
  it('uses withResponse() when the call object provides it', async () => {
    const mockData = { id: 'chatcmpl-1', choices: [{ message: { content: 'hi' } }] };
    const mockResponse = new Response('ok', { status: 200 });
    const call = {
      withResponse: vi.fn().mockResolvedValue({ data: mockData, response: mockResponse }),
      then: undefined, // not a thenable
    };
    const result = await awaitCompletionWithHeaders(call);
    expect(result.data).toBe(mockData);
    expect(result.response).toBe(mockResponse);
    expect(call.withResponse).toHaveBeenCalledOnce();
  });

  it('returns response:undefined when call is a plain Promise (no withResponse)', async () => {
    const mockData = { id: 'chatcmpl-2', choices: [{ message: { content: 'hello' } }] };
    const call = Promise.resolve(mockData);
    const result = await awaitCompletionWithHeaders(call);
    expect(result.data).toBe(mockData);
    expect(result.response).toBeUndefined();
  });

  it('extracts response headers from withResponse path', async () => {
    const headers = new Headers({ 'x-openrouter-cache': 'HIT' });
    const mockResponse = new Response('body', { headers });
    const mockData = { id: 'chatcmpl-3', choices: [] };
    const call = {
      withResponse: vi.fn().mockResolvedValue({ data: mockData, response: mockResponse }),
    };
    const result = await awaitCompletionWithHeaders(call);
    expect(result.response?.headers.get('x-openrouter-cache')).toBe('HIT');
  });

  it('awaits plain promise even when withResponse is a non-function value', async () => {
    // An object that has withResponse but it's a string (not a function)
    const mockData = { id: 'chatcmpl-4', choices: [] };
    const call = Object.assign(Promise.resolve(mockData), {
      withResponse: 'not-a-function',
    });
    const result = await awaitCompletionWithHeaders(call);
    expect(result.data).toBe(mockData);
    expect(result.response).toBeUndefined();
  });

  it('awaits plain promise when withResponse is undefined', async () => {
    const mockData = { id: 'chatcmpl-5', choices: [] };
    const call = Object.assign(Promise.resolve(mockData), {
      withResponse: undefined,
    });
    const result = await awaitCompletionWithHeaders(call);
    expect(result.data).toBe(mockData);
    expect(result.response).toBeUndefined();
  });

  it('propagates errors from withResponse()', async () => {
    const call = {
      withResponse: vi.fn().mockRejectedValue(new Error('network error')),
    };
    await expect(awaitCompletionWithHeaders(call)).rejects.toThrow('network error');
  });

  it('propagates errors from plain promise path', async () => {
    const call = Promise.reject(new Error('upstream 500'));
    await expect(awaitCompletionWithHeaders(call)).rejects.toThrow('upstream 500');
  });

  it('handles withResponse returning null response (defensive)', async () => {
    const mockData = { id: 'chatcmpl-6', choices: [] };
    const call = {
      withResponse: vi.fn().mockResolvedValue({ data: mockData, response: null }),
    };
    // The function returns whatever withResponse gives — null response is valid
    const result = await awaitCompletionWithHeaders(call);
    expect(result.data).toBe(mockData);
    expect(result.response).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7–10. buildStructuredResult
// ---------------------------------------------------------------------------

describe('buildStructuredResult', () => {
  it('includes server_version in _meta by default', () => {
    const result = buildStructuredResult({ valid: true, model: 'openai/gpt-4o' });
    expect(result._meta.server_version).toBe(SERVER_VERSION);
  });

  it('merges custom meta with server_version', () => {
    const result = buildStructuredResult({ value: 42 }, { custom_field: 'test', count: 3 });
    expect(result._meta.server_version).toBe(SERVER_VERSION);
    expect(result._meta.custom_field).toBe('test');
    expect(result._meta.count).toBe(3);
  });

  it('defaults meta to empty when not provided', () => {
    const result = buildStructuredResult('simple string data');
    expect(Object.keys(result._meta)).toEqual(['server_version']);
  });

  it('produces valid JSON in content text for nested objects', () => {
    const data = { nested: { deep: { value: [1, 2, 3] } }, flag: true };
    const result = buildStructuredResult(data);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(data);
  });

  it('produces correct JSON for array data', () => {
    const data = [{ id: 1 }, { id: 2 }];
    const result = buildStructuredResult(data);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(data);
    expect(result.structuredContent).toBe(data);
  });

  it('sets structuredContent to the same reference as data', () => {
    const data = { model: 'test' };
    const result = buildStructuredResult(data);
    expect(result.structuredContent).toBe(data);
  });
});

// ---------------------------------------------------------------------------
// 11–14. readToolPayload
// ---------------------------------------------------------------------------

describe('readToolPayload', () => {
  it('prefers structuredContent over content text', () => {
    const result = readToolPayload({
      structuredContent: { preferred: true },
      content: [{ type: 'text', text: '{"preferred": false}' }],
    });
    expect(result).toEqual({ preferred: true });
  });

  it('falls back to content text when structuredContent is undefined', () => {
    const result = readToolPayload({
      content: [{ type: 'text', text: '{"fallback": true}' }],
    });
    expect(result).toEqual({ fallback: true });
  });

  it('throws when neither structuredContent nor content text is present', () => {
    expect(() => readToolPayload({})).toThrow('no structuredContent or content text');
  });

  it('throws when content array is empty', () => {
    expect(() => readToolPayload({ content: [] })).toThrow('no structuredContent or content text');
  });

  it('throws on invalid JSON in content text', () => {
    expect(() => readToolPayload({ content: [{ type: 'text', text: 'not json' }] })).toThrow();
  });

  it('handles structuredContent with falsy values correctly', () => {
    // structuredContent = 0 (falsy but defined) should be returned
    const result = readToolPayload({ structuredContent: 0 as unknown });
    expect(result).toBe(0);
  });

  it('handles structuredContent = null as defined (returned directly)', () => {
    // null is not === undefined so it should be returned
    const result = readToolPayload({ structuredContent: null as unknown });
    expect(result).toBeNull();
  });

  it('returns empty string structuredContent', () => {
    const result = readToolPayload({ structuredContent: '' as unknown });
    expect(result).toBe('');
  });

  it('returns false structuredContent', () => {
    const result = readToolPayload({ structuredContent: false as unknown });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 15–16. embed_text — remaining edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — additional edge cases', () => {
  it('passes dimensions:undefined explicitly when not specified', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
    });
    await handleEmbedText(embedReq({ texts: 'hello' }), client);
    const callArgs = (client.createEmbeddings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect('dimensions' in callArgs).toBe(true);
    expect(callArgs.dimensions).toBeUndefined();
  });

  it('trims whitespace from model and uses it as fallback when response.model is falsy', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      model: '', // falsy
    });
    const r = (await handleEmbedText(
      embedReq({ texts: 'hi', model: '  custom/embed  ' }),
      client,
    )) as SuccessResult;
    // API call should use trimmed model
    expect((client.createEmbeddings as ReturnType<typeof vi.fn>).mock.calls[0][0].model).toBe(
      'custom/embed',
    );
    // Summary should use the trimmed effective model since response.model is ''
    expect(r.content[0].text).toContain('custom/embed');
    expect(r._meta.model).toBe('custom/embed');
    expect((r.structuredContent as { model: string }).model).toBe('custom/embed');
  });

  it('accepts a single-character text string', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.5] }],
      model: 'openai/text-embedding-3-small',
    });
    const r = (await handleEmbedText(embedReq({ texts: 'x' }), client)) as SuccessResult;
    expect(r.structuredContent).toBeDefined();
    expect((client.createEmbeddings as ReturnType<typeof vi.fn>).mock.calls[0][0].input).toEqual([
      'x',
    ]);
  });

  it('treats boolean texts value as non-string', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: true }),
      mockEmbedClient({}),
    )) as ErrorResult;
    // true is not a string, not an array → wrapped as [true] → texts[0] is not a string
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('rejects number model type', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: 'hello', model: 42 }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('non-empty string');
  });
});

// ---------------------------------------------------------------------------
// 17–20. decide — remaining edge cases
// ---------------------------------------------------------------------------

describe('handleDecide — additional edge cases', () => {
  it('accepts state=undefined and does not pass it through to API', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.6 } },
    });
    await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
        state: undefined,
      }),
      client,
    );
    const apiCall = (client.submitDecision as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(apiCall.state).toBeUndefined();
  });

  it('treats noul=-0 as P=0 and renders NO at 0.0%', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -0 } },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    // -0 is a number, finite, so prob = -0. -0 >= 0.5 is false → NO
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });

  it('correctly finds the max in score array with multiple updates', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [0.05, 0.1, 0.15, 0.4, 0.3] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['terrible', 'bad', 'ok', 'good', 'great'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    // maxVal updates at index 0 (0.05), 1 (0.10), 2 (0.15), 3 (0.40)
    // index 4 (0.30) does not update. Result: level 4/5 at 40.0%
    expect(r.content[0].text).toContain('level 4/5');
    expect(r.content[0].text).toContain('40.0%');
  });

  it('handles choice with negative probabilities (picks least negative)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: -0.5, b: -0.1, c: -0.9 } },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'choice',
            instructions: 'pick',
            criteria: { a: 'A', b: 'B', c: 'C' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    // sort descending: b (-0.1) > a (-0.5) > c (-0.9)
    expect(r.content[0].text).toContain('b');
  });

  it('handles model=true (boolean) as non-string', async () => {
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
        model: true,
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('score with large prob values (>1) still finds max correctly', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [2.5, 1.0, 3.7, 0.5] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['a', 'b', 'c', 'd'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    // max is 3.7 at index 2 → level 3/4
    expect(r.content[0].text).toContain('level 3/4');
    expect(r.content[0].text).toContain('370.0%');
  });

  it('passes state to API when provided', async () => {
    const state = { context: 'important info', nested: { val: 123 } };
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: 0.5 } },
    });
    await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test',
            criteria: { yes: 'y', no: 'n' },
          },
        },
        state,
      }),
      client,
    );
    const apiCall = (client.submitDecision as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(apiCall.state).toEqual(state);
  });
});
