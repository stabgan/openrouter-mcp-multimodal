/**
 * Agent 2 — Coverage for untested MAX_*_LENGTH validation branches across handlers.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Many handlers added MAX_MODEL_ID_LENGTH (256) validation during security
 * hardening but never received corresponding tests. This file closes those
 * gaps along with handler-specific length limits:
 *
 * text-to-speech.ts:
 *  1. model length > 256 → INVALID_INPUT
 *  2. model at exactly 256 → accepted (boundary)
 *  3. voice length > MAX_VOICE_LENGTH (256) → INVALID_INPUT
 *  4. voice at exactly 256 → accepted (boundary)
 *
 * speech-to-text.ts:
 *  5. model length > 256 → INVALID_INPUT
 *  6. model at exactly 256 → accepted (boundary)
 *  7. language length > MAX_LANGUAGE_LENGTH (64) → INVALID_INPUT
 *  8. language at exactly 64 → accepted (boundary)
 *
 * analyze-image.ts:
 *  9. model length > 256 → INVALID_INPUT
 * 10. question length > MAX_QUESTION_LENGTH (100_000) → INVALID_INPUT
 * 11. question at exactly 100_000 → accepted (boundary)
 *
 * analyze-audio.ts:
 * 12. model length > 256 → INVALID_INPUT
 *
 * analyze-video.ts:
 * 13. model length > 256 → INVALID_INPUT
 *
 * generate-image.ts:
 * 14. model length > 256 → INVALID_INPUT
 *
 * generate-audio.ts:
 * 15. model length > 256 → INVALID_INPUT
 * 16. voice length > MAX_VOICE_LENGTH (256) → INVALID_INPUT
 *
 * generate-image-dedicated.ts:
 * 17. model length > 256 → INVALID_INPUT
 *
 * chat-completion.ts:
 * 18. model length > 256 → INVALID_INPUT
 */
import { describe, it, expect, vi } from 'vitest';
import { handleTextToSpeech } from '../tool-handlers/text-to-speech.js';
import { handleSpeechToText } from '../tool-handlers/speech-to-text.js';
import { handleAnalyzeImage } from '../tool-handlers/analyze-image.js';
import { handleAnalyzeAudio } from '../tool-handlers/analyze-audio.js';
import { handleAnalyzeVideo } from '../tool-handlers/analyze-video.js';
import { handleGenerateImage } from '../tool-handlers/generate-image.js';
import { handleGenerateAudio } from '../tool-handlers/generate-audio.js';
import { handleGenerateImageDedicated } from '../tool-handlers/generate-image-dedicated.js';
import { handleChatCompletion } from '../tool-handlers/chat-completion.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

/** Minimal OpenRouterAPIClient mock that should never be called. */
function noopApiClient(): OpenRouterAPIClient {
  return new Proxy({} as OpenRouterAPIClient, {
    get: () => vi.fn().mockRejectedValue(new Error('API should not be called')),
  });
}

/** Minimal OpenAI mock that should never be called (for analyze/generate-image/chat). */
function noopOpenAI(): OpenAI {
  return new Proxy({} as OpenAI, {
    get: () =>
      new Proxy(
        {},
        {
          get: () => vi.fn().mockRejectedValue(new Error('OpenAI should not be called')),
        },
      ),
  });
}

const LONG_MODEL = 'x'.repeat(257);
const EXACT_MODEL = 'x'.repeat(256);

// ═══════════════════════════════════════════════════════════════════════════
// 1–4. text-to-speech — model length + voice length
// ═══════════════════════════════════════════════════════════════════════════

describe('handleTextToSpeech — model and voice length limits', () => {
  const api = noopApiClient();

  it('returns INVALID_INPUT when model exceeds 256 chars', async () => {
    const r = (await handleTextToSpeech(
      { params: { arguments: { input: 'hello', model: LONG_MODEL } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('257');
  });

  it('does not reject model at exactly 256 chars (boundary)', async () => {
    // Model at 256 chars passes the length check — the call proceeds to
    // generateSpeech which we mock to return a valid audio buffer.
    const mp3Header = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const ttsApi = {
      generateSpeech: vi.fn().mockResolvedValue({ buffer: mp3Header, contentType: 'audio/mpeg' }),
    } as unknown as OpenRouterAPIClient;
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', model: EXACT_MODEL } } },
      ttsApi,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
  });

  it('returns INVALID_INPUT when voice exceeds 256 chars', async () => {
    const longVoice = 'v'.repeat(257);
    const r = (await handleTextToSpeech(
      { params: { arguments: { input: 'hello', voice: longVoice } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('voice exceeds max length');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('257');
  });

  it('does not reject voice at exactly 256 chars (boundary)', async () => {
    const exactVoice = 'v'.repeat(256);
    const mp3Header = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const ttsApi = {
      generateSpeech: vi.fn().mockResolvedValue({ buffer: mp3Header, contentType: 'audio/mpeg' }),
    } as unknown as OpenRouterAPIClient;
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', voice: exactVoice } } },
      ttsApi,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5–8. speech-to-text — model length + language length
// ═══════════════════════════════════════════════════════════════════════════

describe('handleSpeechToText — model and language length limits', () => {
  const api = noopApiClient();

  it('returns INVALID_INPUT when model exceeds 256 chars', async () => {
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 'test.wav', model: LONG_MODEL } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('257');
  });

  it('accepts model at exactly 256 chars (passes length validation)', async () => {
    // Length check passes, then the handler proceeds to audio resolution
    // which will fail — but the important thing is we didn't fail on length.
    const sttApi = {
      transcribeAudio: vi.fn().mockResolvedValue({ text: 'transcribed' }),
    } as unknown as OpenRouterAPIClient;
    const b64 = Buffer.from('RIFFxxxxWAVE').toString('base64');
    const r = await handleSpeechToText(
      { params: { arguments: { audio_path: `data:audio/wav;base64,${b64}`, model: EXACT_MODEL } } },
      sttApi,
    );
    // Should not be INVALID_INPUT for model length
    if ((r as { isError?: boolean }).isError) {
      expect((r as ErrorResult)._meta.code).not.toBe('INVALID_INPUT');
    }
  });

  it('returns INVALID_INPUT when language exceeds 64 chars', async () => {
    const longLang = 'l'.repeat(65);
    const r = (await handleSpeechToText(
      { params: { arguments: { audio_path: 'test.wav', language: longLang } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('language exceeds max length');
    expect(r.content[0].text).toContain('64');
    expect(r.content[0].text).toContain('65');
  });

  it('accepts language at exactly 64 chars (passes length validation)', async () => {
    const exactLang = 'e'.repeat(64);
    const sttApi = {
      transcribeAudio: vi.fn().mockResolvedValue({ text: 'ok' }),
    } as unknown as OpenRouterAPIClient;
    const b64 = Buffer.from('RIFFxxxxWAVE').toString('base64');
    const r = await handleSpeechToText(
      {
        params: {
          arguments: { audio_path: `data:audio/wav;base64,${b64}`, language: exactLang },
        },
      },
      sttApi,
    );
    // Should not be INVALID_INPUT for language length
    if ((r as { isError?: boolean }).isError) {
      expect((r as ErrorResult)._meta.code).not.toBe('INVALID_INPUT');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9–11. analyze-image — model length + question length
// ═══════════════════════════════════════════════════════════════════════════

describe('handleAnalyzeImage — model and question length limits', () => {
  const openai = noopOpenAI();

  it('returns INVALID_INPUT when model exceeds 256 chars', async () => {
    const r = (await handleAnalyzeImage(
      { params: { arguments: { image_path: 'test.jpg', model: LONG_MODEL } } },
      openai,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
  });

  it('returns INVALID_INPUT when question exceeds 100_000 chars', async () => {
    const longQuestion = 'q'.repeat(100_001);
    const r = (await handleAnalyzeImage(
      { params: { arguments: { image_path: 'test.jpg', question: longQuestion } } },
      openai,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('question exceeds max length');
    expect(r.content[0].text).toContain('100000');
    expect(r.content[0].text).toContain('100001');
  });

  it('accepts question at exactly 100_000 chars (passes length validation)', async () => {
    const exactQuestion = 'q'.repeat(100_000);
    // The handler will proceed past validation to image resolution which
    // will fail on the fake path — but question length check passed.
    const r = await handleAnalyzeImage(
      {
        params: {
          arguments: { image_path: 'data:image/png;base64,iVBOR', question: exactQuestion },
        },
      },
      openai,
    );
    // Should not fail on question length
    if ((r as { isError?: boolean }).isError) {
      expect((r as ErrorResult).content[0].text).not.toContain('question exceeds max length');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. analyze-audio — model length
// ═══════════════════════════════════════════════════════════════════════════

describe('handleAnalyzeAudio — model length limit', () => {
  const openai = noopOpenAI();

  it('returns INVALID_INPUT when model exceeds 256 chars', async () => {
    const r = (await handleAnalyzeAudio(
      { params: { arguments: { audio_path: 'test.wav', model: LONG_MODEL } } },
      openai,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. analyze-video — model length
// ═══════════════════════════════════════════════════════════════════════════

describe('handleAnalyzeVideo — model length limit', () => {
  const openai = noopOpenAI();

  it('returns INVALID_INPUT when model exceeds 256 chars', async () => {
    const r = (await handleAnalyzeVideo(
      { params: { arguments: { video_path: 'test.mp4', model: LONG_MODEL } } },
      openai,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. generate-image — model length
// ═══════════════════════════════════════════════════════════════════════════

describe('handleGenerateImage — model length limit', () => {
  const openai = noopOpenAI();

  it('returns INVALID_INPUT when model exceeds 256 chars', async () => {
    const r = (await handleGenerateImage(
      { params: { arguments: { prompt: 'a cat', model: LONG_MODEL } } },
      openai,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15–16. generate-audio — model length + voice length
// ═══════════════════════════════════════════════════════════════════════════

describe('handleGenerateAudio — model and voice length limits', () => {
  const api = noopApiClient();
  const openai = noopOpenAI();

  it('returns INVALID_INPUT when model exceeds 256 chars', async () => {
    const r = (await handleGenerateAudio(
      { params: { arguments: { prompt: 'hello world', model: LONG_MODEL } } },
      openai,
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
  });

  it('returns INVALID_INPUT when voice exceeds 256 chars', async () => {
    const longVoice = 'v'.repeat(257);
    const r = (await handleGenerateAudio(
      { params: { arguments: { prompt: 'hello world', voice: longVoice } } },
      openai,
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('voice exceeds max length');
    expect(r.content[0].text).toContain('256');
    expect(r.content[0].text).toContain('257');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. generate-image-dedicated — model length
// ═══════════════════════════════════════════════════════════════════════════

describe('handleGenerateImageDedicated — model length limit', () => {
  const api = noopApiClient();

  it('returns INVALID_INPUT when model exceeds 256 chars', async () => {
    const r = (await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'a cat', model: LONG_MODEL } } },
      api,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. chat-completion — model length
// ═══════════════════════════════════════════════════════════════════════════

describe('handleChatCompletion — model length limit', () => {
  const openai = noopOpenAI();

  it('returns INVALID_INPUT when model exceeds 256 chars', async () => {
    const r = (await handleChatCompletion(
      {
        params: {
          arguments: {
            messages: [{ role: 'user', content: 'hello' }],
            model: LONG_MODEL,
          },
        },
      },
      openai,
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('model identifier exceeds max length');
    expect(r.content[0].text).toContain('256');
  });
});
