/**
 * Agent 2 — Coverage for untested enum/type-validation branches and
 * response metadata paths across multiple handlers.
 *
 * NOTE: Multiple agents may edit the repo concurrently. This file ONLY
 * adds tests in src/__tests__/ — it does NOT modify source code.
 *
 * Targets (confirmed untested via exhaustive grep of all test files):
 *
 * speech-to-text.ts:
 *  1. response_format non-string type check (number → 'must be a string')
 *  2. response_format non-string type check (boolean → 'must be a string')
 *  3. response_format non-string type check (object → 'must be a string')
 *  4. Response metadata: response.language included in _meta
 *  5. Response metadata: response.duration included as duration_seconds
 *  6. content_is_untrusted always present in _meta
 *  7. temperature = 0 boundary (valid)
 *  8. temperature = 1 boundary (valid)
 *  9. temperature = Infinity (invalid, non-finite)
 *
 * text-to-speech.ts:
 * 10. response_format non-string type check (number → 'must be a string')
 * 11. response_format non-string type check (boolean → 'must be a string')
 *
 * generate-image-dedicated.ts:
 * 12. quality non-string type check (number → 'must be a string')
 * 13. quality non-string type check (boolean → 'must be a string')
 * 14. output_format non-string type check (number → 'must be a string')
 * 15. output_format non-string type check (object → 'must be a string')
 *
 * generate-video.ts:
 * 16. aspect_ratio non-string type check (number → 'must be a string')
 * 17. resolution non-string type check (boolean → 'must be a string')
 * 18. first_frame_image non-string type check (number → 'must be a string')
 * 19. last_frame_image non-string type check (boolean → 'must be a string')
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleSpeechToText } from '../tool-handlers/speech-to-text.js';
import { handleTextToSpeech } from '../tool-handlers/text-to-speech.js';
import { handleGenerateImageDedicated } from '../tool-handlers/generate-image-dedicated.js';
import { handleGenerateVideo } from '../tool-handlers/generate-video.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import { ErrorCode } from '../errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string; [k: string]: unknown };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  _meta: Record<string, unknown>;
};

// Minimal WAV data URL for speech-to-text tests (passes format detection)
function wavDataUrl(): string {
  const b64 = Buffer.from('RIFFxxxxWAVE').toString('base64');
  return `data:audio/wav;base64,${b64}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–3. speech-to-text — response_format non-string type check
// ═══════════════════════════════════════════════════════════════════════════

describe('handleSpeechToText — response_format type validation', () => {
  const mockApi = {
    transcribeAudio: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('returns INVALID_INPUT when response_format is a number', async () => {
    const r = (await handleSpeechToText(
      {
        params: { arguments: { audio_path: 'test.wav', response_format: 42 as unknown as string } },
      },
      mockApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('response_format must be a string');
  });

  it('returns INVALID_INPUT when response_format is a boolean', async () => {
    const r = (await handleSpeechToText(
      {
        params: {
          arguments: { audio_path: 'test.wav', response_format: true as unknown as string },
        },
      },
      mockApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('response_format must be a string');
  });

  it('returns INVALID_INPUT when response_format is an object', async () => {
    const r = (await handleSpeechToText(
      {
        params: {
          arguments: {
            audio_path: 'test.wav',
            response_format: { type: 'json' } as unknown as string,
          },
        },
      },
      mockApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('response_format must be a string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4–6. speech-to-text — response metadata (language, duration, untrusted)
// ═══════════════════════════════════════════════════════════════════════════

describe('handleSpeechToText — response metadata fields', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = `/tmp/stt-meta-test-${Date.now()}`;
    vi.stubEnv('OPENROUTER_INPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('includes language and duration_seconds from response in _meta', async () => {
    const api = {
      transcribeAudio: vi.fn().mockResolvedValue({
        text: 'hello world',
        language: 'en',
        duration: 3.5,
      }),
    } as unknown as OpenRouterAPIClient;

    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl() } } },
      api,
    )) as SuccessResult;

    expect(r._meta.language).toBe('en');
    expect(r._meta.duration_seconds).toBe(3.5);
  });

  it('always includes content_is_untrusted in _meta', async () => {
    const api = {
      transcribeAudio: vi.fn().mockResolvedValue({ text: 'transcribed' }),
    } as unknown as OpenRouterAPIClient;

    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl() } } },
      api,
    )) as SuccessResult;

    expect(r._meta.content_is_untrusted).toBe(true);
  });

  it('omits language and duration from _meta when absent in response', async () => {
    const api = {
      transcribeAudio: vi.fn().mockResolvedValue({ text: 'just text' }),
    } as unknown as OpenRouterAPIClient;

    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl() } } },
      api,
    )) as SuccessResult;

    expect(r._meta.language).toBeUndefined();
    expect(r._meta.duration_seconds).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7–9. speech-to-text — temperature boundary tests
// ═══════════════════════════════════════════════════════════════════════════

describe('handleSpeechToText — temperature boundaries', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = `/tmp/stt-temp-test-${Date.now()}`;
    vi.stubEnv('OPENROUTER_INPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts temperature = 0 (lower boundary)', async () => {
    const api = {
      transcribeAudio: vi.fn().mockResolvedValue({ text: 'ok' }),
    } as unknown as OpenRouterAPIClient;

    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl(), temperature: 0 } } },
      api,
    )) as SuccessResult;

    expect(r._meta).toBeDefined();
    expect(api.transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0 }),
      expect.anything(),
    );
  });

  it('accepts temperature = 1 (upper boundary)', async () => {
    const api = {
      transcribeAudio: vi.fn().mockResolvedValue({ text: 'ok' }),
    } as unknown as OpenRouterAPIClient;

    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: wavDataUrl(), temperature: 1 } } },
      api,
    )) as SuccessResult;

    expect(r._meta).toBeDefined();
    expect(api.transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 1 }),
      expect.anything(),
    );
  });

  it('returns INVALID_INPUT when temperature is Infinity', async () => {
    const api = {
      transcribeAudio: vi.fn(),
    } as unknown as OpenRouterAPIClient;

    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 'test.wav', temperature: Infinity } } },
      api,
    )) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('temperature');
  });

  it('returns INVALID_INPUT when temperature is NaN', async () => {
    const api = {
      transcribeAudio: vi.fn(),
    } as unknown as OpenRouterAPIClient;

    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 'test.wav', temperature: NaN } } },
      api,
    )) as ErrorResult;

    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('temperature');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10–11. text-to-speech — response_format non-string type check
// ═══════════════════════════════════════════════════════════════════════════

describe('handleTextToSpeech — response_format type validation', () => {
  const mockApi = {
    generateSpeech: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('returns INVALID_INPUT when response_format is a number', async () => {
    const r = (await handleTextToSpeech(
      {
        params: {
          arguments: { input: 'hello', response_format: 42 as unknown as string },
        },
      },
      mockApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('response_format must be a string');
  });

  it('returns INVALID_INPUT when response_format is a boolean', async () => {
    const r = (await handleTextToSpeech(
      {
        params: {
          arguments: { input: 'hello', response_format: true as unknown as string },
        },
      },
      mockApi,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('response_format must be a string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12–15. generate-image-dedicated — quality and output_format type checks
// ═══════════════════════════════════════════════════════════════════════════

describe('handleGenerateImageDedicated — enum param type validation', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '/tmp');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const api = {
    generateImage: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('returns INVALID_INPUT when quality is a number', async () => {
    const r = (await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a cat', quality: 5 as unknown as string } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('quality must be a string');
  });

  it('returns INVALID_INPUT when quality is a boolean', async () => {
    const r = (await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a cat', quality: true as unknown as string } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('quality must be a string');
  });

  it('returns INVALID_INPUT when output_format is a number', async () => {
    const r = (await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a cat', output_format: 1 as unknown as string } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('output_format must be a string');
  });

  it('returns INVALID_INPUT when output_format is an object', async () => {
    const r = (await handleGenerateImageDedicated(
      {
        params: {
          arguments: { prompt: 'a cat', output_format: { type: 'png' } as unknown as string },
        },
      },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('output_format must be a string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16–19. generate-video — enum and frame param type checks
// ═══════════════════════════════════════════════════════════════════════════

describe('handleGenerateVideo — enum and frame param type validation', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '/tmp');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const api = {
    submitVideoGeneration: vi.fn(),
  } as unknown as OpenRouterAPIClient;

  it('returns INVALID_INPUT when aspect_ratio is a number', async () => {
    const r = (await handleGenerateVideo(
      { params: { arguments: { prompt: 'a sunset', aspect_ratio: 16 as unknown as string } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('aspect_ratio must be a string');
  });

  it('returns INVALID_INPUT when resolution is a boolean', async () => {
    const r = (await handleGenerateVideo(
      { params: { arguments: { prompt: 'a sunset', resolution: false as unknown as string } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('resolution must be a string');
  });

  it('returns INVALID_INPUT when first_frame_image is a number', async () => {
    const r = (await handleGenerateVideo(
      {
        params: {
          arguments: { prompt: 'a sunset', first_frame_image: 123 as unknown as string },
        },
      },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('first_frame_image must be a string');
  });

  it('returns INVALID_INPUT when last_frame_image is a boolean', async () => {
    const r = (await handleGenerateVideo(
      {
        params: {
          arguments: { prompt: 'a sunset', last_frame_image: true as unknown as string },
        },
      },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(r.content[0].text).toContain('last_frame_image must be a string');
  });
});
