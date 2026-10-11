/**
 * Agent 2 — Coverage for untested validation branches across handlers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets identified by static analysis of source vs existing tests:
 *
 * text-to-speech.ts:
 *  1. MAX_INPUT_LENGTH (100_000) — reject input exceeding limit
 *  2. Boundary: input at exactly 100_000 chars (should pass to API call)
 *  3. MAX_INSTRUCTIONS_LENGTH (10_000) — reject instructions exceeding limit
 *  4. Boundary: instructions at exactly 10_000 chars
 *
 * speech-to-text.ts:
 *  5. audio_path missing/undefined validation
 *  6. audio_path empty string validation
 *  7. audio_path whitespace-only validation
 *  8. model type validation (non-string)
 *  9. language type validation (non-string)
 *  10. Transcription returning no text (null text)
 *  11. Missing arguments fallback
 *  12. temperature negative (below 0)
 *  13. temperature non-number type
 *
 * get-model-info.ts:
 *  14. MODEL_NOT_FOUND suggestions include search_models and validate_model hints
 *  15. model as undefined (missing arguments.model)
 *
 * search-models.ts:
 *  16. Missing arguments fallback (undefined)
 *  17. capabilities as a string (invalid type)
 *  18. Internal error from searchPaginated catch block
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTextToSpeech } from '../tool-handlers/text-to-speech.js';
import { handleSpeechToText } from '../tool-handlers/speech-to-text.js';
import { handleGetModelInfo } from '../tool-handlers/get-model-info.js';
import { handleSearchModels } from '../tool-handlers/search-models.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; suggestions?: string[] };
};

// ---------------------------------------------------------------------------
// text-to-speech.ts — MAX_INPUT_LENGTH and MAX_INSTRUCTIONS_LENGTH
// ---------------------------------------------------------------------------

describe('handleTextToSpeech — input length limits', () => {
  const mockTtsApi = {
    generateSpeech: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('returns INVALID_INPUT when input exceeds 100_000 characters', async () => {
    const longInput = 'a'.repeat(100_001);
    const r = (await handleTextToSpeech(
      { params: { arguments: { input: longInput } } },
      mockTtsApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('input exceeds max length');
    expect(r.content[0].text).toContain('100000');
    expect(r.content[0].text).toContain('100001');
  });

  it('returns INVALID_INPUT for very large input (200K chars)', async () => {
    const hugeInput = 'b'.repeat(200_000);
    const r = (await handleTextToSpeech(
      { params: { arguments: { input: hugeInput } } },
      mockTtsApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('200000');
  });

  it('accepts input at exactly 100_000 characters (calls API)', async () => {
    const maxInput = 'c'.repeat(100_000);
    // Mock a valid response from the API
    const mp3Header = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const api = {
      generateSpeech: vi.fn().mockResolvedValue({ buffer: mp3Header, contentType: 'audio/mpeg' }),
    } as unknown as OpenRouterAPIClient;
    const r = await handleTextToSpeech({ params: { arguments: { input: maxInput } } }, api);
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    expect(api.generateSpeech).toHaveBeenCalled();
  });
});

describe('handleTextToSpeech — instructions length limits', () => {
  const mockTtsApi = {
    generateSpeech: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('returns INVALID_INPUT when instructions exceeds 10_000 characters', async () => {
    const longInstructions = 'x'.repeat(10_001);
    const r = (await handleTextToSpeech(
      { params: { arguments: { input: 'hello', instructions: longInstructions } } },
      mockTtsApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('instructions exceeds max length');
    expect(r.content[0].text).toContain('10000');
    expect(r.content[0].text).toContain('10001');
  });

  it('accepts instructions at exactly 10_000 characters (calls API)', async () => {
    const maxInstructions = 'y'.repeat(10_000);
    const mp3Header = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const api = {
      generateSpeech: vi.fn().mockResolvedValue({ buffer: mp3Header, contentType: 'audio/mpeg' }),
    } as unknown as OpenRouterAPIClient;
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', instructions: maxInstructions } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    expect(api.generateSpeech).toHaveBeenCalled();
    // Verify instructions was passed to the API
    const body = api.generateSpeech.mock.calls[0][0] as Record<string, unknown>;
    expect(body.instructions).toBe(maxInstructions);
  });
});

// ---------------------------------------------------------------------------
// speech-to-text.ts — untested validation branches
// ---------------------------------------------------------------------------

describe('handleSpeechToText — audio_path validation', () => {
  const mockSttApi = {
    transcribeAudio: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('returns INVALID_INPUT when audio_path is undefined (missing)', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: {} as { audio_path: string } } },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('audio_path is required');
  });

  it('returns INVALID_INPUT when audio_path is empty string', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: '' } } },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('audio_path is required');
  });

  it('returns INVALID_INPUT when audio_path is whitespace-only', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: '   \t  ' } } },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('audio_path is required');
  });

  it('returns INVALID_INPUT when audio_path is a number', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 42 as unknown as string } } },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('audio_path is required');
  });
});

describe('handleSpeechToText — model type validation', () => {
  const mockSttApi = {
    transcribeAudio: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('returns INVALID_INPUT when model is a number', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 'test.wav', model: 123 as unknown as string } } },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model must be a string');
  });

  it('returns INVALID_INPUT when model is a boolean', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 'test.wav', model: true as unknown as string } } },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model must be a string');
  });
});

describe('handleSpeechToText — language type validation', () => {
  const mockSttApi = {
    transcribeAudio: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('returns INVALID_INPUT when language is a number', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 'test.wav', language: 42 as unknown as string } } },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('language must be a string');
  });

  it('returns INVALID_INPUT when language is a boolean', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 'test.wav', language: false as unknown as string } } },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('language must be a string');
  });

  it('returns INVALID_INPUT when language is an object', async () => {
    const r = (await handleSpeechToText(
      {
        params: {
          arguments: { audio_path: 'test.wav', language: { code: 'en' } as unknown as string },
        },
      },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('language must be a string');
  });
});

describe('handleSpeechToText — temperature edge cases', () => {
  const mockSttApi = {
    transcribeAudio: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('returns INVALID_INPUT when temperature is negative', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 'test.wav', temperature: -0.1 } } },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('temperature');
    expect(r.content[0].text).toContain('between 0 and 1');
  });

  it('returns INVALID_INPUT when temperature is NaN', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 'test.wav', temperature: NaN } } },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when temperature is a string', async () => {
    const r = (await handleSpeechToText(
      {
        params: {
          arguments: { audio_path: 'test.wav', temperature: '0.5' as unknown as number },
        },
      },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when temperature is Infinity', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 'test.wav', temperature: Infinity } } },
      mockSttApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

describe('handleSpeechToText — transcription response edge cases', () => {
  it('returns INTERNAL when transcription returns null text', async () => {
    const api = {
      transcribeAudio: vi.fn().mockResolvedValue({ text: null }),
    } as unknown as OpenRouterAPIClient;
    const b64 = Buffer.from('RIFFxxxxWAVE').toString('base64');
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: `data:audio/wav;base64,${b64}` } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('Transcription returned no text');
  });

  it('returns INTERNAL when transcription returns undefined text', async () => {
    const api = {
      transcribeAudio: vi.fn().mockResolvedValue({}),
    } as unknown as OpenRouterAPIClient;
    const b64 = Buffer.from('RIFFxxxxWAVE').toString('base64');
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: `data:audio/wav;base64,${b64}` } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('Transcription returned no text');
  });

  it('handles missing arguments gracefully', async () => {
    const api = {
      transcribeAudio: vi.fn(),
    } as unknown as OpenRouterAPIClient;
    const r = (await handleSpeechToText(
      { params: { arguments: undefined as unknown as { audio_path: string } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// get-model-info.ts — MODEL_NOT_FOUND suggestions
// ---------------------------------------------------------------------------

describe('handleGetModelInfo — MODEL_NOT_FOUND suggestions', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.setModels([{ id: 'openai/gpt-4o' }]);
  });

  it('includes actionable suggestions for unknown model', async () => {
    const r = (await handleGetModelInfo(
      { params: { arguments: { model: 'unknown/model-xyz' } } },
      cache,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('MODEL_NOT_FOUND');
    expect(r._meta.suggestions).toBeDefined();
    expect(r._meta.suggestions!.some((s) => /search_models/i.test(s))).toBe(true);
    expect(r._meta.suggestions!.some((s) => /validate_model/i.test(s))).toBe(true);
  });

  it('returns MODEL_NOT_FOUND with model name in message', async () => {
    const r = (await handleGetModelInfo(
      { params: { arguments: { model: 'nonexistent/model-v99' } } },
      cache,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('nonexistent/model-v99');
    expect(r.content[0].text).toContain('not found');
  });

  it('returns INVALID_INPUT when model argument is undefined', async () => {
    const r = (await handleGetModelInfo(
      { params: { arguments: { model: undefined as unknown as string } } },
      cache,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model is required');
  });
});

// ---------------------------------------------------------------------------
// search-models.ts — missing arguments and edge cases
// ---------------------------------------------------------------------------

describe('handleSearchModels — missing arguments', () => {
  let cache: ModelCache;
  let mockApi: OpenRouterAPIClient;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.setModels(
      Array.from({ length: 30 }, (_, i) => ({
        id: `provider/model-${i}`,
        name: `Model ${i}`,
      })),
    );
    mockApi = {
      getModels: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as OpenRouterAPIClient;
  });

  it('handles undefined arguments gracefully (falls back to defaults)', async () => {
    const r = await handleSearchModels(
      { params: { arguments: undefined as unknown as { query?: string } } },
      mockApi,
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    // Should return paginated results with defaults
    const sc = (r as { structuredContent: Record<string, unknown> }).structuredContent;
    expect(sc.results).toBeDefined();
    expect(sc.limit).toBeDefined();
    expect(sc.offset).toBe(0);
  });

  it('returns INVALID_INPUT when capabilities is a string', async () => {
    const r = await handleSearchModels(
      {
        params: {
          arguments: { capabilities: 'vision' as unknown as { vision?: boolean } },
        },
      },
      mockApi,
      cache,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
    expect((r as ErrorResult).content[0].text).toContain('capabilities must be an object');
  });

  it('returns INVALID_INPUT when capabilities is a number', async () => {
    const r = await handleSearchModels(
      {
        params: {
          arguments: { capabilities: 42 as unknown as { vision?: boolean } },
        },
      },
      mockApi,
      cache,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when capabilities is a boolean', async () => {
    const r = await handleSearchModels(
      {
        params: {
          arguments: { capabilities: true as unknown as { vision?: boolean } },
        },
      },
      mockApi,
      cache,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when offset is Infinity', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { offset: Infinity } } },
      mockApi,
      cache,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when offset is a boolean', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { offset: true as unknown as number } } },
      mockApi,
      cache,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when limit is a boolean', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { limit: false as unknown as number } } },
      mockApi,
      cache,
    );
    expect((r as ErrorResult).isError).toBe(true);
    expect((r as ErrorResult)._meta.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// validate-model.ts — missing model argument
// ---------------------------------------------------------------------------

describe('handleValidateModel — model undefined edge case', () => {
  it('returns INVALID_INPUT when arguments.model is undefined', async () => {
    const cache = ModelCache.getInstance();
    cache.setModels([{ id: 'openai/gpt-4o' }]);
    // Import inline to avoid name clash with other agent files
    const { handleValidateModel } = await import('../tool-handlers/validate-model.js');
    const r = await handleValidateModel(
      { params: { arguments: { model: undefined as unknown as string } } },
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain(
      'model is required',
    );
  });
});
