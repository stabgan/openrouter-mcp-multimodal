/**
 * Tests for previously uncovered code paths across multiple handlers.
 *
 * Targets:
 * - classifyResourceLoadError (openrouter-errors.ts) — all branches
 * - classifyEmptyCompletion + detectReasoningCutoff (completion-utils.ts)
 * - capResultText truncation (completion-utils.ts)
 * - validate-model error branches
 * - get-model-info error branches
 * - text-to-speech input validation
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  classifyUpstreamError,
  classifyResourceLoadError,
} from '../tool-handlers/openrouter-errors.js';
import {
  classifyEmptyCompletion,
  detectReasoningCutoff,
  capResultText,
  extractCompletionText,
  type ExtractedText,
} from '../tool-handlers/completion-utils.js';
import { handleValidateModel } from '../tool-handlers/validate-model.js';
import { handleGetModelInfo } from '../tool-handlers/get-model-info.js';
import { handleTextToSpeech } from '../tool-handlers/text-to-speech.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { UnsafePathError } from '../tool-handlers/path-safety.js';

// ---------------------------------------------------------------------------
// classifyResourceLoadError
// ---------------------------------------------------------------------------
describe('classifyResourceLoadError', () => {
  it('maps UnsafePathError to UNSAFE_PATH', () => {
    const err = new UnsafePathError('/etc/passwd');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe('UNSAFE_PATH');
  });

  it('maps UnsafePathError with prefix', () => {
    const err = new UnsafePathError('/etc/shadow');
    const r = classifyResourceLoadError(err, 'image_path');
    expect(r.content[0].text).toContain('image_path');
    expect(r._meta.code).toBe('UNSAFE_PATH');
  });

  it('maps "Blocked host" to UPSTREAM_REFUSED with SSRF suggestions', () => {
    const err = new Error('Blocked host: 127.0.0.1 is not allowed');
    const r = classifyResourceLoadError(err, 'audio_path');
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /loopback/i.test(s))).toBe(true);
  });

  it('maps "too large" to RESOURCE_TOO_LARGE', () => {
    const err = new Error('Resource too large: 50MB exceeds limit');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe('RESOURCE_TOO_LARGE');
    expect(r._meta.suggestions).toBeDefined();
  });

  it('maps "timed out" to UPSTREAM_TIMEOUT', () => {
    const err = new Error('Request timed out after 30000ms');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
    expect(r._meta.suggestions!.some((s) => /retry/i.test(s))).toBe(true);
  });

  it('maps "timeout" to UPSTREAM_TIMEOUT', () => {
    const err = new Error('Connection timeout');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('maps "unsupported" format to UNSUPPORTED_FORMAT', () => {
    const err = new Error('Unsupported image format: .bmp');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe('UNSUPPORTED_FORMAT');
    expect(r._meta.suggestions).toBeDefined();
  });

  it('maps "not a video" to UNSUPPORTED_FORMAT', () => {
    const err = new Error('File is not a video: application/pdf');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('maps "invalid data url" to UNSUPPORTED_FORMAT', () => {
    const err = new Error('invalid data url: missing base64 marker');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('falls back to INVALID_INPUT for generic errors', () => {
    const err = new Error('File not found: /tmp/nope.png');
    const r = classifyResourceLoadError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.suggestions).toBeDefined();
  });

  it('handles string errors in fallback', () => {
    const r = classifyResourceLoadError('something went wrong');
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('preserves prefix on all branches', () => {
    const cases = [
      new Error('Resource too large'),
      new Error('Connection timeout'),
      new Error('Unsupported format'),
      new Error('generic failure'),
    ];
    for (const err of cases) {
      const r = classifyResourceLoadError(err, 'video_path "/tmp/v.mp4"');
      expect(r.content[0].text).toContain('video_path');
    }
  });
});

// ---------------------------------------------------------------------------
// classifyEmptyCompletion
// ---------------------------------------------------------------------------
describe('classifyEmptyCompletion', () => {
  it('maps content_filter to UPSTREAM_REFUSED', () => {
    const extracted: ExtractedText = {
      text: '',
      reasonedOnly: false,
      finishReason: 'content_filter',
      nativeFinishReason: undefined,
    };
    const r = classifyEmptyCompletion(extracted, 'Vision model');
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r.content[0].text).toContain('content filter');
    expect(r.content[0].text).toContain('Vision model');
    expect(r._meta.suggestions!.some((s) => /rephrase/i.test(s))).toBe(true);
  });

  it('maps length to INVALID_INPUT with max_tokens suggestion', () => {
    const extracted: ExtractedText = {
      text: '',
      reasonedOnly: false,
      finishReason: 'length',
      nativeFinishReason: undefined,
    };
    const r = classifyEmptyCompletion(extracted, 'Audio model');
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('max_tokens');
    expect(r._meta.suggestions!.some((s) => /max_tokens/i.test(s))).toBe(true);
  });

  it('maps tool_calls to INVALID_INPUT with tool-use explanation', () => {
    const extracted: ExtractedText = {
      text: '',
      reasonedOnly: false,
      finishReason: 'tool_calls',
      nativeFinishReason: undefined,
    };
    const r = classifyEmptyCompletion(extracted, 'Chat model');
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('tool calls');
  });

  it('maps function_call to INVALID_INPUT', () => {
    const extracted: ExtractedText = {
      text: '',
      reasonedOnly: false,
      finishReason: 'function_call',
      nativeFinishReason: undefined,
    };
    const r = classifyEmptyCompletion(extracted, 'Test');
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('falls back to INTERNAL for unknown finish reasons', () => {
    const extracted: ExtractedText = {
      text: '',
      reasonedOnly: false,
      finishReason: 'stop',
      nativeFinishReason: undefined,
    };
    const r = classifyEmptyCompletion(extracted, 'Model X');
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('Model X');
  });

  it('includes native_finish_reason in details when present', () => {
    const extracted: ExtractedText = {
      text: '',
      reasonedOnly: false,
      finishReason: 'content_filter',
      nativeFinishReason: 'safety',
    };
    const r = classifyEmptyCompletion(extracted, 'Test');
    expect(r._meta.details?.native_finish_reason).toBe('safety');
  });
});

// ---------------------------------------------------------------------------
// detectReasoningCutoff
// ---------------------------------------------------------------------------
describe('detectReasoningCutoff', () => {
  it('returns null when not reasoning-only', () => {
    const extracted: ExtractedText = {
      text: 'Hello',
      reasonedOnly: false,
      finishReason: 'length',
      nativeFinishReason: undefined,
    };
    expect(detectReasoningCutoff(extracted)).toBeNull();
  });

  it('returns null when reasoning-only but finish_reason is stop', () => {
    const extracted: ExtractedText = {
      text: 'thinking...',
      reasonedOnly: true,
      finishReason: 'stop',
      nativeFinishReason: undefined,
    };
    expect(detectReasoningCutoff(extracted)).toBeNull();
  });

  it('returns INVALID_INPUT when reasoning-only and finish_reason is length', () => {
    const extracted: ExtractedText = {
      text: 'Let me think about this step by step...',
      reasonedOnly: true,
      finishReason: 'length',
      nativeFinishReason: undefined,
      usage: {
        prompt_tokens: 100,
        completion_tokens: 4096,
        total_tokens: 4196,
      },
    };
    const r = detectReasoningCutoff(extracted);
    expect(r).not.toBeNull();
    expect(r!._meta.code).toBe('INVALID_INPUT');
    expect(r!.content[0].text).toContain('max_tokens');
    expect(r!._meta.details?.reasoning_preview).toBeDefined();
    expect(r!._meta.details?.usage).toMatchObject({ prompt_tokens: 100 });
  });

  it('truncates reasoning preview to 200 chars', () => {
    const longText = 'x'.repeat(500);
    const extracted: ExtractedText = {
      text: longText,
      reasonedOnly: true,
      finishReason: 'length',
      nativeFinishReason: undefined,
    };
    const r = detectReasoningCutoff(extracted)!;
    expect((r._meta.details?.reasoning_preview as string).length).toBe(200);
  });

  it('handles missing usage gracefully', () => {
    const extracted: ExtractedText = {
      text: 'reasoning',
      reasonedOnly: true,
      finishReason: 'length',
      nativeFinishReason: undefined,
    };
    const r = detectReasoningCutoff(extracted)!;
    expect(r._meta.details?.usage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// capResultText — truncation path
// ---------------------------------------------------------------------------
describe('capResultText — truncation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('truncates text exceeding the cap and marks truncated', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '50');
    const text = 'a'.repeat(200);
    const result = capResultText(text);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(text.length);
    expect(result.text).toContain('truncated');
    expect(result.text).toContain('150 chars omitted');
  });

  it('handles invalid env var by using default', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', 'not-a-number');
    const text = 'a'.repeat(10);
    const result = capResultText(text);
    expect(result.truncated).toBe(false);
  });

  it('handles negative env var by using default', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '-100');
    const text = 'a'.repeat(10);
    const result = capResultText(text);
    expect(result.truncated).toBe(false);
  });

  it('handles empty string env var by using default', () => {
    vi.stubEnv('OPENROUTER_MAX_RESULT_TEXT_CHARS', '');
    const text = 'a'.repeat(10);
    const result = capResultText(text);
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractCompletionText — edge cases
// ---------------------------------------------------------------------------
describe('extractCompletionText — edge cases', () => {
  it('extracts refusal text when present', () => {
    const completion = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            refusal: 'I cannot help with that',
          },
          finish_reason: 'stop',
        },
      ],
    } as unknown as import('openai/resources/chat/completions.js').ChatCompletion;
    const r = extractCompletionText(completion);
    expect(r.text).toBe('I cannot help with that');
    expect(r.reasonedOnly).toBe(false);
  });

  it('extracts text from array content parts', () => {
    const completion = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'text', text: 'world' },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    } as unknown as import('openai/resources/chat/completions.js').ChatCompletion;
    const r = extractCompletionText(completion);
    expect(r.text).toBe('Hello world');
  });

  it('falls back to reasoning when content is empty', () => {
    const completion = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            reasoning: 'Let me think about this...',
          },
          finish_reason: 'stop',
        },
      ],
    } as unknown as import('openai/resources/chat/completions.js').ChatCompletion;
    const r = extractCompletionText(completion);
    expect(r.text).toBe('Let me think about this...');
    expect(r.reasonedOnly).toBe(true);
  });

  it('extracts reasoning from reasoning_details array', () => {
    const completion = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            reasoning_details: [
              { type: 'text', text: 'Step 1' },
              { type: 'text', text: 'Step 2' },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    } as unknown as import('openai/resources/chat/completions.js').ChatCompletion;
    const r = extractCompletionText(completion);
    expect(r.text).toBe('Step 1\nStep 2');
    expect(r.reasonedOnly).toBe(true);
  });

  it('returns empty when choices array is empty', () => {
    const completion = {
      choices: [],
    } as unknown as import('openai/resources/chat/completions.js').ChatCompletion;
    const r = extractCompletionText(completion);
    expect(r.text).toBe('');
  });

  it('captures native_finish_reason when present', () => {
    const completion = {
      choices: [
        {
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
          native_finish_reason: 'end_turn',
        },
      ],
    } as unknown as import('openai/resources/chat/completions.js').ChatCompletion;
    const r = extractCompletionText(completion);
    expect(r.nativeFinishReason).toBe('end_turn');
  });
});

// ---------------------------------------------------------------------------
// handleValidateModel — error branches
// ---------------------------------------------------------------------------
describe('handleValidateModel — error branches', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.reset();
    cache.setModels([{ id: 'openai/gpt-4o' }, { id: 'anthropic/claude-sonnet-4' }]);
  });

  it('returns INVALID_INPUT when model is a number', async () => {
    const r = await handleValidateModel(
      { params: { arguments: { model: 42 as unknown as string } } },
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('string');
  });

  it('returns INVALID_INPUT when model is empty string', async () => {
    const r = await handleValidateModel({ params: { arguments: { model: '' } } }, cache);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when model is whitespace-only', async () => {
    const r = await handleValidateModel({ params: { arguments: { model: '   ' } } }, cache);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('classifies upstream error from ensureFresh', async () => {
    cache.reset();
    const apiClient = {
      getModels: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 })),
    } as unknown as OpenRouterAPIClient;
    const r = await handleValidateModel(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
      apiClient,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns INTERNAL when cache is not valid and no apiClient', async () => {
    cache.reset();
    const r = await handleValidateModel(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INTERNAL');
  });

  it('returns valid=false for unknown model', async () => {
    const r = await handleValidateModel(
      { params: { arguments: { model: 'nonexistent/model' } } },
      cache,
    );
    const sc = (r as { structuredContent?: { valid: boolean } }).structuredContent;
    expect(sc?.valid).toBe(false);
  });

  it('returns valid=true for known model', async () => {
    const r = await handleValidateModel(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    const sc = (r as { structuredContent?: { valid: boolean } }).structuredContent;
    expect(sc?.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleGetModelInfo — error branches
// ---------------------------------------------------------------------------
describe('handleGetModelInfo — error branches', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.reset();
    cache.setModels([
      { id: 'openai/gpt-4o', name: 'GPT-4o', context_length: 128000 },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet' },
    ]);
  });

  it('returns INVALID_INPUT when model is a boolean', async () => {
    const r = await handleGetModelInfo(
      { params: { arguments: { model: true as unknown as string } } },
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when model is empty string', async () => {
    const r = await handleGetModelInfo({ params: { arguments: { model: '' } } }, cache);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when model is whitespace-only', async () => {
    const r = await handleGetModelInfo({ params: { arguments: { model: '  \t  ' } } }, cache);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns MODEL_NOT_FOUND for unknown model', async () => {
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'nonexistent/model-v99' } } },
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('MODEL_NOT_FOUND');
    expect((r as { _meta: { suggestions?: string[] } })._meta.suggestions).toBeDefined();
    expect(
      (r as { _meta: { suggestions?: string[] } })._meta.suggestions!.some((s) =>
        /search_models/i.test(s),
      ),
    ).toBe(true);
  });

  it('classifies upstream error from ensureFresh', async () => {
    cache.reset();
    const apiClient = {
      getModels: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Bad gateway'), { status: 502 })),
    } as unknown as OpenRouterAPIClient;
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
      apiClient,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UPSTREAM_HTTP');
  });

  it('returns INTERNAL when cache is not valid and no apiClient', async () => {
    cache.reset();
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INTERNAL');
  });

  it('returns model info for known model', async () => {
    const r = await handleGetModelInfo(
      { params: { arguments: { model: 'openai/gpt-4o' } } },
      cache,
    );
    const sc = (r as { structuredContent?: Record<string, unknown> }).structuredContent;
    expect(sc?.id).toBe('openai/gpt-4o');
    expect(sc?.name).toBe('GPT-4o');
  });
});

// ---------------------------------------------------------------------------
// handleTextToSpeech — input validation
// ---------------------------------------------------------------------------
describe('handleTextToSpeech — input validation', () => {
  const mockApiClient = {
    generateSpeech: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('returns INVALID_INPUT when input is missing', async () => {
    const r = await handleTextToSpeech(
      {
        params: {
          arguments: {} as Parameters<typeof handleTextToSpeech>[0]['params']['arguments'],
        },
      },
      mockApiClient,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('input');
  });

  it('returns INVALID_INPUT when input is empty string', async () => {
    const r = await handleTextToSpeech({ params: { arguments: { input: '' } } }, mockApiClient);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when input is whitespace-only', async () => {
    const r = await handleTextToSpeech({ params: { arguments: { input: '   ' } } }, mockApiClient);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when model is not a string', async () => {
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', model: 123 as unknown as string } } },
      mockApiClient,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('model');
  });

  it('returns INVALID_INPUT when voice is not a string', async () => {
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', voice: 42 as unknown as string } } },
      mockApiClient,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('voice');
  });

  it('returns INVALID_INPUT for invalid response_format', async () => {
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', response_format: 'invalid_fmt' } } },
      mockApiClient,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain(
      'response_format',
    );
  });

  it('returns INVALID_INPUT when speed is below minimum', async () => {
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', speed: 0.1 } } },
      mockApiClient,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('speed');
  });

  it('returns INVALID_INPUT when speed is above maximum', async () => {
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', speed: 5.0 } } },
      mockApiClient,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when speed is NaN', async () => {
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', speed: NaN } } },
      mockApiClient,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when speed is not a number', async () => {
    const r = await handleTextToSpeech(
      {
        params: {
          arguments: { input: 'hello', speed: 'fast' as unknown as number },
        },
      },
      mockApiClient,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when instructions is not a string', async () => {
    const r = await handleTextToSpeech(
      {
        params: {
          arguments: { input: 'hello', instructions: 42 as unknown as string },
        },
      },
      mockApiClient,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('instructions');
  });

  it('accepts valid speed at minimum boundary', async () => {
    // Speed 0.25 is valid — should pass validation and reach the API call
    (
      mockApiClient as { generateSpeech: ReturnType<typeof vi.fn> }
    ).generateSpeech.mockRejectedValue(new Error('mock upstream'));
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', speed: 0.25 } } },
      mockApiClient,
    );
    // Should NOT be an INVALID_INPUT error — it passed validation
    if ((r as { isError?: boolean }).isError) {
      expect((r as { _meta: { code: string } })._meta.code).not.toBe('INVALID_INPUT');
    }
  });

  it('accepts valid speed at maximum boundary', async () => {
    (
      mockApiClient as { generateSpeech: ReturnType<typeof vi.fn> }
    ).generateSpeech.mockRejectedValue(new Error('mock upstream'));
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', speed: 4.0 } } },
      mockApiClient,
    );
    if ((r as { isError?: boolean }).isError) {
      expect((r as { _meta: { code: string } })._meta.code).not.toBe('INVALID_INPUT');
    }
  });
});

// ---------------------------------------------------------------------------
// classifyUpstreamError — ZDR and remaining branches
// ---------------------------------------------------------------------------
describe('classifyUpstreamError — ZDR errors', () => {
  it('maps "zero data retention" to ZDR_INCOMPATIBLE', () => {
    const err = new Error('zero data retention policy not supported by provider');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('ZDR_INCOMPATIBLE');
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /data_collection/i.test(s))).toBe(true);
  });

  it('maps "zdr" abbreviation to ZDR_INCOMPATIBLE', () => {
    const err = new Error('Provider does not support zdr');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('ZDR_INCOMPATIBLE');
  });

  it('preserves context label on ZDR errors', () => {
    const err = new Error('zero data retention mismatch');
    const r = classifyUpstreamError(err, 'chat_completion');
    expect(r.content[0].text.startsWith('chat_completion:')).toBe(true);
  });
});

describe('classifyUpstreamError — non-Error inputs', () => {
  it('handles plain string errors', () => {
    const r = classifyUpstreamError('something broke');
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe('something broke');
  });

  it('handles object with message property', () => {
    const r = classifyUpstreamError({ message: 'object error', status: 500 });
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });

  it('handles object with nested error.message', () => {
    const r = classifyUpstreamError({
      error: { message: 'nested error message', code: 401 },
    });
    expect(r.content[0].text).toContain('nested error message');
  });

  it('handles object with string error property', () => {
    const r = classifyUpstreamError({ error: 'string error' });
    expect(r.content[0].text).toContain('string error');
  });

  it('falls back to "unknown error" for opaque values', () => {
    const r = classifyUpstreamError(12345);
    expect(r.content[0].text).toBe('unknown error');
  });

  it('falls back to "unknown error" for null', () => {
    const r = classifyUpstreamError(null);
    expect(r.content[0].text).toBe('unknown error');
  });

  it('falls back to "unknown error" for empty object', () => {
    const r = classifyUpstreamError({});
    expect(r.content[0].text).toBe('unknown error');
  });

  it('extracts status from string code that looks like HTTP status', () => {
    const r = classifyUpstreamError({ code: '404', message: 'not here' });
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
  });

  it('extracts status from error.code (nested)', () => {
    const r = classifyUpstreamError({
      error: { code: 429, message: 'rate limited' },
    });
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('extracts status from HTTP pattern in message', () => {
    const r = classifyUpstreamError(new Error('Received HTTP 502 from upstream'));
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
  });
});

describe('classifyUpstreamError — insufficient balance variations', () => {
  it('maps "insufficient credits" to UPSTREAM_REFUSED credits', () => {
    const err = new Error('Your account has insufficient credits');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details?.reason).toBe('credits');
  });

  it('maps "requires more credits" to UPSTREAM_REFUSED credits', () => {
    const err = new Error('This model requires more credits than your balance');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details?.reason).toBe('credits');
  });

  it('maps "requires at least" to UPSTREAM_REFUSED credits', () => {
    const err = new Error('requires at least $5.00 balance');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details?.reason).toBe('credits');
  });
});

describe('classifyUpstreamError — auth variations', () => {
  it('maps "invalid api key" message to INVALID_CREDENTIALS', () => {
    const err = new Error('invalid api key provided');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps "missing api key" to INVALID_CREDENTIALS', () => {
    const err = new Error('missing api key in request');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps "user not found" to INVALID_CREDENTIALS', () => {
    const err = new Error('user not found for this api key');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps "authentication failed" to INVALID_CREDENTIALS', () => {
    const err = new Error('authentication failed');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });

  it('maps 403 with "invalid credentials" to INVALID_CREDENTIALS', () => {
    const err = Object.assign(new Error('invalid credentials'), { status: 403 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('classifyUpstreamError — guardrail variations', () => {
  it('maps "moderation" to UPSTREAM_REFUSED policy', () => {
    const err = new Error('Content flagged by moderation system');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details?.reason).toBe('policy');
  });

  it('maps "guardrail" to UPSTREAM_REFUSED policy', () => {
    const err = new Error('Request blocked by guardrail');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details?.reason).toBe('policy');
  });

  it('maps "blocked:" prefix to UPSTREAM_REFUSED policy', () => {
    const err = new Error('blocked: prompt contains prohibited content');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_REFUSED');
    expect(r._meta.details?.reason).toBe('policy');
  });
});

describe('classifyUpstreamError — timeout variations', () => {
  it('maps "timed out" text to UPSTREAM_TIMEOUT', () => {
    const err = new Error('Request timed out waiting for upstream');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('maps "the operation was aborted" to UPSTREAM_TIMEOUT', () => {
    const err = new Error('The operation was aborted');
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('does not map "aborted" with ECONNABORTED to UPSTREAM_TIMEOUT', () => {
    // ECONNABORTED should be classified as connection_reset, not timeout
    const err = Object.assign(new Error('The operation was aborted'), {
      code: 'ECONNABORTED',
    });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.details?.reason).toBe('connection_reset');
  });
});

describe('classifyUpstreamError — generic 4xx', () => {
  it('maps unrecognized 400 to INVALID_INPUT', () => {
    const err = Object.assign(new Error('Bad Request: unknown field'), { status: 400 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r._meta.suggestions).toBeDefined();
  });

  it('maps unrecognized 422 to INVALID_INPUT', () => {
    const err = Object.assign(new Error('Unprocessable entity'), { status: 422 });
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

describe('classifyUpstreamError — Retry-After header parsing', () => {
  it('reads retry-after from response.headers (nested)', () => {
    const err = {
      status: 429,
      message: 'rate limited',
      response: { headers: new Headers({ 'retry-after': '10' }) },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBe(10);
  });

  it('reads retry-after from plain object headers', () => {
    const err = {
      status: 429,
      message: 'rate limited',
      headers: { 'retry-after': '15' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBe(15);
  });

  it('reads Retry-After (capitalized) from plain object headers', () => {
    const err = {
      status: 429,
      message: 'rate limited',
      headers: { 'Retry-After': '20' },
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.retry_after_seconds).toBe(20);
  });

  it('passes retry_after_seconds through on 5xx with Retry-After', () => {
    const err = {
      status: 503,
      message: 'Service unavailable',
      headers: new Headers({ 'retry-after': '60' }),
    };
    const r = classifyUpstreamError(err);
    expect(r._meta.code).toBe('UPSTREAM_HTTP');
    expect(r._meta.retry_after_seconds).toBe(60);
  });
});
