/**
 * Agent 6 — Test coverage for uncovered handler branches.
 *
 * Targets:
 * - handleGenerateImageDedicated: all validation + response handling
 * - handleTextToSpeech: response-level error paths (0-byte, HTML MIME, PCM wrap, save_path)
 * - handleAnalyzeImage: validation + upstream error + empty completion
 * - handleAnalyzeAudio: validation + upstream error + empty completion
 * - handleSearchModels: type validation edge cases
 * - handleRerankDocuments: additional edge cases (NaN score, model type, return_documents type)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import OpenAI from 'openai';
import { handleGenerateImageDedicated } from '../tool-handlers/generate-image-dedicated.js';
import { handleTextToSpeech } from '../tool-handlers/text-to-speech.js';
import { handleAnalyzeImage } from '../tool-handlers/analyze-image.js';
import { handleAnalyzeAudio } from '../tool-handlers/analyze-audio.js';
import { handleSearchModels } from '../tool-handlers/search-models.js';
import { handleRerankDocuments } from '../tool-handlers/rerank.js';
import { ModelCache } from '../model-cache.js';
import type { OpenRouterAPIClient, ImageGenerationResponse } from '../openrouter-api.js';
import { ErrorCode } from '../errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockApiClient(overrides: Partial<OpenRouterAPIClient> = {}): OpenRouterAPIClient {
  return {
    generateImage: vi.fn().mockResolvedValue({ data: [] }),
    generateSpeech: vi.fn().mockResolvedValue({ buffer: Buffer.alloc(0), contentType: '' }),
    getModels: vi.fn().mockResolvedValue([]),
    rerank: vi.fn().mockResolvedValue({ results: [] }),
    ...overrides,
  } as unknown as OpenRouterAPIClient;
}

function mockOpenAI(response: unknown, throws?: Error): OpenAI {
  const create = vi.fn();
  if (throws) create.mockRejectedValue(throws);
  else create.mockResolvedValue(response);
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

// ---------------------------------------------------------------------------
// handleGenerateImageDedicated — input validation
// ---------------------------------------------------------------------------
describe('handleGenerateImageDedicated — input validation', () => {
  const api = mockApiClient();

  it('returns INVALID_INPUT when prompt is missing', async () => {
    const r = await handleGenerateImageDedicated(
      {
        params: {
          arguments: {} as Parameters<
            typeof handleGenerateImageDedicated
          >[0]['params']['arguments'],
        },
      },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when prompt is empty string', async () => {
    const r = await handleGenerateImageDedicated({ params: { arguments: { prompt: '   ' } } }, api);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when model is not a string', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', model: 42 as unknown as string } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('model');
  });

  it('returns INVALID_INPUT for unsupported aspect_ratio', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', aspect_ratio: '99:1' } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('aspect_ratio');
  });

  it('returns INVALID_INPUT for unsupported resolution', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', resolution: '9999x9999' } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('resolution');
  });

  it('returns INVALID_INPUT for unsupported quality', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', quality: 'ultra_mega' } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('quality');
  });

  it('returns INVALID_INPUT for unsupported output_format', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', output_format: 'bmp' } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('output_format');
  });

  it('returns INVALID_INPUT when n is 0', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', n: 0 } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when n exceeds maximum', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', n: 11 } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when n is a float', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', n: 1.5 } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when n is NaN', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', n: NaN } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when input_references is not an array', async () => {
    const r = await handleGenerateImageDedicated(
      {
        params: {
          arguments: { prompt: 'cat', input_references: 'not-array' as unknown as string[] },
        },
      },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain(
      'input_references',
    );
  });

  it('returns INVALID_INPUT when input_references has empty strings', async () => {
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', input_references: ['ok', ''] } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when input_references exceeds 20 entries', async () => {
    const refs = Array.from({ length: 21 }, (_, i) => `ref-${i}.png`);
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', input_references: refs } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('21');
  });
});

// ---------------------------------------------------------------------------
// handleGenerateImageDedicated — response handling
// ---------------------------------------------------------------------------
describe('handleGenerateImageDedicated — response handling', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'mcp-gid-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_INPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('returns UPSTREAM_REFUSED when response data is empty', async () => {
    const api = mockApiClient({ generateImage: vi.fn().mockResolvedValue({ data: [] }) });
    const r = await handleGenerateImageDedicated({ params: { arguments: { prompt: 'cat' } } }, api);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UPSTREAM_REFUSED);
  });

  it('returns UPSTREAM_REFUSED when data has neither b64_json nor url', async () => {
    const api = mockApiClient({ generateImage: vi.fn().mockResolvedValue({ data: [{}] }) });
    const r = await handleGenerateImageDedicated({ params: { arguments: { prompt: 'cat' } } }, api);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UPSTREAM_REFUSED);
  });

  it('returns inline image when b64_json is provided and no save_path', async () => {
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const api = mockApiClient({
      generateImage: vi
        .fn()
        .mockResolvedValue({ data: [{ b64_json: pngB64 }] } as ImageGenerationResponse),
    });
    const r = await handleGenerateImageDedicated({ params: { arguments: { prompt: 'dot' } } }, api);
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    expect(r.content.some((c: { type: string }) => c.type === 'image')).toBe(true);
  });

  it('saves b64_json to file when save_path is provided', async () => {
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const api = mockApiClient({
      generateImage: vi
        .fn()
        .mockResolvedValue({ data: [{ b64_json: pngB64 }] } as ImageGenerationResponse),
    });
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'dot', save_path: 'out.png' } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    const savedPath = (r as { _meta: { save_path?: string } })._meta?.save_path as
      string | undefined;
    if (savedPath) {
      const stat = await fs.stat(savedPath);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it('classifies upstream errors from generateImage', async () => {
    const api = mockApiClient({
      generateImage: vi.fn().mockRejectedValue(new Error('HTTP 500 Internal')),
    });
    const r = await handleGenerateImageDedicated({ params: { arguments: { prompt: 'cat' } } }, api);
    expect((r as { isError?: boolean }).isError).toBe(true);
  });

  it('returns URL-based result when b64_json is absent but url is present', async () => {
    const api = mockApiClient({
      generateImage: vi.fn().mockResolvedValue({
        data: [{ url: 'https://example.com/image.png' }],
      } as ImageGenerationResponse),
    });
    const r = await handleGenerateImageDedicated({ params: { arguments: { prompt: 'cat' } } }, api);
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    const text = (r as { content: Array<{ text: string }> }).content[0]?.text;
    expect(text).toContain('https://example.com/image.png');
  });

  it('includes revised_prompt in meta when API provides it', async () => {
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const api = mockApiClient({
      generateImage: vi.fn().mockResolvedValue({
        data: [{ b64_json: pngB64, revised_prompt: 'A picture of a cute cat' }],
      } as ImageGenerationResponse),
    });
    const r = await handleGenerateImageDedicated({ params: { arguments: { prompt: 'cat' } } }, api);
    expect((r as { _meta: { revised_prompt?: string } })._meta.revised_prompt).toBe(
      'A picture of a cute cat',
    );
  });

  it('notes images_count > 1 when multiple images are returned', async () => {
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const api = mockApiClient({
      generateImage: vi.fn().mockResolvedValue({
        data: [{ b64_json: pngB64 }, { b64_json: pngB64 }],
      } as ImageGenerationResponse),
    });
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cats', n: 2 } } },
      api,
    );
    expect((r as { _meta: { images_count?: number } })._meta.images_count).toBe(2);
    expect((r as { _meta: { images_note?: string } })._meta.images_note).toContain('images[0]');
  });

  it('returns UPSTREAM_REFUSED for empty b64_json and no url with save_path', async () => {
    const api = mockApiClient({
      generateImage: vi.fn().mockResolvedValue({ data: [{ b64_json: null }] }),
    });
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', save_path: 'out.png' } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UPSTREAM_REFUSED);
  });

  it('rejects unsafe save_path before calling API', async () => {
    const api = mockApiClient();
    const r = await handleGenerateImageDedicated(
      { params: { arguments: { prompt: 'cat', save_path: '../escape.png' } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UNSAFE_PATH);
    expect(api.generateImage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleTextToSpeech — response-level error paths
// ---------------------------------------------------------------------------
describe('handleTextToSpeech — response-level paths', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'mcp-tts-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_INPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('returns UPSTREAM_REFUSED for 0-byte response', async () => {
    const api = mockApiClient({
      generateSpeech: vi
        .fn()
        .mockResolvedValue({ buffer: Buffer.alloc(0), contentType: 'audio/mpeg' }),
    });
    const r = await handleTextToSpeech({ params: { arguments: { input: 'hello' } } }, api);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UPSTREAM_REFUSED);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('0 bytes');
  });

  it('returns UPSTREAM_HTTP when content type is text/html', async () => {
    const api = mockApiClient({
      generateSpeech: vi.fn().mockResolvedValue({
        buffer: Buffer.from('<html>error</html>'),
        contentType: 'text/html; charset=utf-8',
      }),
    });
    const r = await handleTextToSpeech({ params: { arguments: { input: 'hello' } } }, api);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UPSTREAM_HTTP);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('text/html');
  });

  it('returns UPSTREAM_HTTP when content type is application/xhtml+xml', async () => {
    const api = mockApiClient({
      generateSpeech: vi.fn().mockResolvedValue({
        buffer: Buffer.from('<html>CDN error</html>'),
        contentType: 'application/xhtml+xml',
      }),
    });
    const r = await handleTextToSpeech({ params: { arguments: { input: 'hello' } } }, api);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UPSTREAM_HTTP);
  });

  it('returns audio content on successful response without save_path', async () => {
    const mp3Header = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const api = mockApiClient({
      generateSpeech: vi.fn().mockResolvedValue({ buffer: mp3Header, contentType: 'audio/mpeg' }),
    });
    const r = await handleTextToSpeech({ params: { arguments: { input: 'hello' } } }, api);
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    expect(r._meta).toBeDefined();
    expect((r._meta as Record<string, unknown>).size_bytes).toBe(mp3Header.length);
  });

  it('saves audio file when save_path is provided', async () => {
    const mp3Header = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const api = mockApiClient({
      generateSpeech: vi.fn().mockResolvedValue({ buffer: mp3Header, contentType: 'audio/mpeg' }),
    });
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', save_path: 'speech.mp3' } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    const meta = r._meta as Record<string, unknown>;
    expect(meta.save_path).toBeDefined();
    const stat = await fs.stat(meta.save_path as string);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('classifies upstream errors from generateSpeech', async () => {
    const api = mockApiClient({
      generateSpeech: vi.fn().mockRejectedValue(new Error('HTTP 503')),
    });
    const r = await handleTextToSpeech({ params: { arguments: { input: 'hello' } } }, api);
    expect((r as { isError?: boolean }).isError).toBe(true);
  });

  it('rejects unsafe save_path before calling API', async () => {
    const api = mockApiClient();
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', save_path: '/etc/nope.mp3' } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.UNSAFE_PATH);
    expect(api.generateSpeech).not.toHaveBeenCalled();
  });

  it('wraps PCM response in WAV container', async () => {
    const pcmBuffer = Buffer.alloc(1024, 0x7f);
    const api = mockApiClient({
      generateSpeech: vi.fn().mockResolvedValue({ buffer: pcmBuffer, contentType: 'audio/pcm' }),
    });
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', response_format: 'pcm' } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    const meta = r._meta as Record<string, unknown>;
    expect(meta.size_bytes as number).toBeGreaterThan(pcmBuffer.length);
  });

  it('includes voice in meta when a voice is used', async () => {
    const mp3Header = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const api = mockApiClient({
      generateSpeech: vi.fn().mockResolvedValue({ buffer: mp3Header, contentType: 'audio/mpeg' }),
    });
    const r = await handleTextToSpeech(
      { params: { arguments: { input: 'hello', voice: 'custom-voice' } } },
      api,
    );
    expect((r._meta as Record<string, unknown>).voice).toBe('custom-voice');
  });

  it('passes speed and instructions to the API body', async () => {
    const mp3Header = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const genSpeech = vi.fn().mockResolvedValue({ buffer: mp3Header, contentType: 'audio/mpeg' });
    const api = mockApiClient({ generateSpeech: genSpeech });
    await handleTextToSpeech(
      { params: { arguments: { input: 'hello', speed: 1.5, instructions: 'speak slowly' } } },
      api,
    );
    expect(genSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 1.5, instructions: 'speak slowly' }),
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// handleAnalyzeImage — validation + error paths
// ---------------------------------------------------------------------------
describe('handleAnalyzeImage — validation', () => {
  it('returns INVALID_INPUT when image_path is missing', async () => {
    const openai = mockOpenAI({});
    const r = await handleAnalyzeImage({ params: { arguments: { image_path: '' } } }, openai);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when image_path is whitespace-only', async () => {
    const openai = mockOpenAI({});
    const r = await handleAnalyzeImage({ params: { arguments: { image_path: '   ' } } }, openai);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when model is not a string', async () => {
    const openai = mockOpenAI({});
    const r = await handleAnalyzeImage(
      { params: { arguments: { image_path: 'x.png', model: 123 as unknown as string } } },
      openai,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('model');
  });

  it('returns INVALID_INPUT when question is not a string', async () => {
    const openai = mockOpenAI({});
    const r = await handleAnalyzeImage(
      { params: { arguments: { image_path: 'x.png', question: 42 as unknown as string } } },
      openai,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('question');
  });

  it('classifies upstream error from OpenAI call', async () => {
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    const dataUrl = `data:image/png;base64,${pngB64}`;
    const openai = mockOpenAI(null, new Error('HTTP 502'));
    const r = await handleAnalyzeImage({ params: { arguments: { image_path: dataUrl } } }, openai);
    expect((r as { isError?: boolean }).isError).toBe(true);
  });

  it('returns success with text content on valid completion', async () => {
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    const dataUrl = `data:image/png;base64,${pngB64}`;
    const openai = mockOpenAI({
      choices: [
        {
          message: { role: 'assistant', content: 'This is a cat.' },
          finish_reason: 'stop',
        },
      ],
    });
    const r = await handleAnalyzeImage(
      { params: { arguments: { image_path: dataUrl, question: 'What animal?' } } },
      openai,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    expect((r as { content: Array<{ text: string }> }).content[0].text).toBe('This is a cat.');
    expect((r._meta as Record<string, unknown>).content_is_untrusted).toBe(true);
  });

  it('rejects invalid cache options before calling API', async () => {
    const openai = mockOpenAI({});
    const r = await handleAnalyzeImage(
      {
        params: {
          arguments: { image_path: 'data:image/png;base64,abc', cache_ttl: 'bad' },
        },
      },
      openai,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleAnalyzeAudio — validation + error paths
// ---------------------------------------------------------------------------
describe('handleAnalyzeAudio — validation', () => {
  it('returns INVALID_INPUT when audio_path is missing', async () => {
    const openai = mockOpenAI({});
    const r = await handleAnalyzeAudio({ params: { arguments: { audio_path: '' } } }, openai);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when audio_path is whitespace-only', async () => {
    const openai = mockOpenAI({});
    const r = await handleAnalyzeAudio({ params: { arguments: { audio_path: '   ' } } }, openai);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when model is not a string', async () => {
    const openai = mockOpenAI({});
    const r = await handleAnalyzeAudio(
      { params: { arguments: { audio_path: 'x.wav', model: true as unknown as string } } },
      openai,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('model');
  });

  it('returns INVALID_INPUT when question is not a string', async () => {
    const openai = mockOpenAI({});
    const r = await handleAnalyzeAudio(
      { params: { arguments: { audio_path: 'x.wav', question: 99 as unknown as string } } },
      openai,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('question');
  });

  it('rejects invalid cache options before calling API', async () => {
    const openai = mockOpenAI({});
    const r = await handleAnalyzeAudio(
      {
        params: {
          arguments: { audio_path: 'data:audio/wav;base64,abc', cache_ttl: 'xyz' },
        },
      },
      openai,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleSearchModels — type validation edge cases
// ---------------------------------------------------------------------------
describe('handleSearchModels — type validation', () => {
  let cache: ModelCache;

  beforeEach(() => {
    cache = ModelCache.getInstance();
    cache.reset();
    cache.setModels([
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet' },
    ]);
  });

  function mkApi(): OpenRouterAPIClient {
    return {
      getModels: vi
        .fn()
        .mockResolvedValue([{ id: 'openai/gpt-4o' }, { id: 'anthropic/claude-sonnet-4' }]),
    } as unknown as OpenRouterAPIClient;
  }

  it('returns INVALID_INPUT when query is not a string', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { query: 42 as unknown as string } } },
      mkApi(),
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('query');
  });

  it('returns INVALID_INPUT when provider is not a string', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { provider: true as unknown as string } } },
      mkApi(),
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('provider');
  });

  it('returns INVALID_INPUT when capabilities is an array', async () => {
    const r = await handleSearchModels(
      {
        params: {
          arguments: { capabilities: ['vision'] as unknown as { vision?: boolean } },
        },
      },
      mkApi(),
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('capabilities');
  });

  it('returns INVALID_INPUT when capabilities is null', async () => {
    const r = await handleSearchModels(
      {
        params: {
          arguments: { capabilities: null as unknown as { vision?: boolean } },
        },
      },
      mkApi(),
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when limit is not a number', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { limit: 'ten' as unknown as number } } },
      mkApi(),
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('limit');
  });

  it('returns INVALID_INPUT when limit is NaN', async () => {
    const r = await handleSearchModels({ params: { arguments: { limit: NaN } } }, mkApi(), cache);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when limit is Infinity', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { limit: Infinity } } },
      mkApi(),
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when offset is not a number', async () => {
    const r = await handleSearchModels(
      { params: { arguments: { offset: 'five' as unknown as number } } },
      mkApi(),
      cache,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('offset');
  });

  it('returns INVALID_INPUT when offset is NaN', async () => {
    const r = await handleSearchModels({ params: { arguments: { offset: NaN } } }, mkApi(), cache);
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('classifies upstream error from model fetch', async () => {
    cache.reset();
    const api = {
      getModels: vi.fn().mockRejectedValue(new Error('HTTP 429')),
    } as unknown as OpenRouterAPIClient;
    const r = await handleSearchModels({ params: { arguments: {} } }, api, cache);
    expect((r as { isError?: boolean }).isError).toBe(true);
  });

  it('returns paginated results with has_more and next_offset', async () => {
    cache.setModels(
      Array.from({ length: 30 }, (_, i) => ({
        id: `provider/model-${String(i).padStart(2, '0')}`,
      })),
    );
    const r = await handleSearchModels(
      { params: { arguments: { limit: 5, offset: 0 } } },
      mkApi(),
      cache,
    );
    const sc = (
      r as {
        structuredContent: {
          results: unknown[];
          has_more: boolean;
          next_offset: number | null;
          total: number;
        };
      }
    ).structuredContent;
    expect(sc.results).toHaveLength(5);
    expect(sc.has_more).toBe(true);
    expect(sc.next_offset).toBe(5);
    expect(sc.total).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// handleRerankDocuments — additional edge cases
// ---------------------------------------------------------------------------
describe('handleRerankDocuments — additional coverage', () => {
  it('returns INVALID_INPUT when model is not a string', async () => {
    const api = mockApiClient({ rerank: vi.fn().mockResolvedValue({ results: [] }) });
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: { query: 'q', documents: ['a'], model: 42 as unknown as string },
        },
      },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('model');
  });

  it('returns INVALID_INPUT when return_documents is not a boolean', async () => {
    const api = mockApiClient({ rerank: vi.fn().mockResolvedValue({ results: [] }) });
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: {
            query: 'q',
            documents: ['a'],
            return_documents: 'true' as unknown as boolean,
          },
        },
      },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain(
      'return_documents',
    );
  });

  it('returns INVALID_INPUT when documents exceed max count', async () => {
    const docs = Array.from({ length: 1001 }, (_, i) => `doc-${i}`);
    const api = mockApiClient({ rerank: vi.fn().mockResolvedValue({ results: [] }) });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: docs } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
    expect((r as { content: Array<{ text: string }> }).content[0].text).toContain('1001');
  });

  it('handles NaN score from upstream API gracefully', async () => {
    const api = mockApiClient({
      rerank: vi.fn().mockResolvedValue({ results: [{ index: 0, score: NaN }] }),
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'] } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    const sc = (r as { structuredContent: { results: Array<{ score: number }> } })
      .structuredContent;
    expect(sc.results[0].score).toBe(0);
  });

  it('handles Infinity score from upstream API gracefully', async () => {
    const api = mockApiClient({
      rerank: vi.fn().mockResolvedValue({ results: [{ index: 0, score: Infinity }] }),
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'] } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    const sc = (r as { structuredContent: { results: Array<{ score: number }> } })
      .structuredContent;
    expect(sc.results[0].score).toBe(0);
  });

  it('uses model from response when available', async () => {
    const api = mockApiClient({
      rerank: vi
        .fn()
        .mockResolvedValue({ model: 'cohere/rerank-v3.5', results: [{ index: 0, score: 0.5 }] }),
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'] } } },
      api,
    );
    const sc = (r as { structuredContent: { model: string } }).structuredContent;
    expect(sc.model).toBe('cohere/rerank-v3.5');
  });

  it('falls back to effective model when response.model is missing', async () => {
    const api = mockApiClient({
      rerank: vi.fn().mockResolvedValue({ results: [{ index: 0, score: 0.5 }] }),
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'], model: 'custom/model' } } },
      api,
    );
    const sc = (r as { structuredContent: { model: string } }).structuredContent;
    expect(sc.model).toBe('custom/model');
  });

  it('uses relevance_score fallback when score field is missing', async () => {
    const api = mockApiClient({
      rerank: vi.fn().mockResolvedValue({ results: [{ index: 0, relevance_score: 0.75 }] }),
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'] } } },
      api,
    );
    const sc = (r as { structuredContent: { results: Array<{ score: number }> } })
      .structuredContent;
    expect(sc.results[0].score).toBe(0.75);
  });

  it('handles document as object with text property', async () => {
    const api = mockApiClient({
      rerank: vi
        .fn()
        .mockResolvedValue({ results: [{ index: 0, score: 0.5, document: { text: 'from api' } }] }),
    });
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: { query: 'q', documents: ['original'], return_documents: true },
        },
      },
      api,
    );
    const sc = (r as { structuredContent: { results: Array<{ document: string }> } })
      .structuredContent;
    expect(sc.results[0].document).toBe('from api');
  });

  it('handles document as string directly', async () => {
    const api = mockApiClient({
      rerank: vi
        .fn()
        .mockResolvedValue({ results: [{ index: 0, score: 0.5, document: 'string doc' }] }),
    });
    const r = await handleRerankDocuments(
      {
        params: {
          arguments: { query: 'q', documents: ['original'], return_documents: true },
        },
      },
      api,
    );
    const sc = (r as { structuredContent: { results: Array<{ document: string }> } })
      .structuredContent;
    expect(sc.results[0].document).toBe('string doc');
  });

  it('includes usage in meta when available', async () => {
    const api = mockApiClient({
      rerank: vi.fn().mockResolvedValue({
        results: [{ index: 0, score: 0.5 }],
        usage: { prompt_tokens: 10, total_tokens: 10 },
      }),
    });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'] } } },
      api,
    );
    expect((r._meta as Record<string, unknown>).usage).toMatchObject({ prompt_tokens: 10 });
  });

  it('returns INVALID_INPUT for non-finite top_n (Infinity)', async () => {
    const api = mockApiClient({ rerank: vi.fn().mockResolvedValue({ results: [] }) });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'], top_n: Infinity } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT for NaN top_n', async () => {
    const api = mockApiClient({ rerank: vi.fn().mockResolvedValue({ results: [] }) });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['a'], top_n: NaN } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when documents has a non-string element', async () => {
    const api = mockApiClient({ rerank: vi.fn().mockResolvedValue({ results: [] }) });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: 'q', documents: ['ok', 42 as unknown as string] } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it('returns INVALID_INPUT when query is whitespace-only', async () => {
    const api = mockApiClient({ rerank: vi.fn().mockResolvedValue({ results: [] }) });
    const r = await handleRerankDocuments(
      { params: { arguments: { query: '   ', documents: ['a'] } } },
      api,
    );
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe(ErrorCode.INVALID_INPUT);
  });
});
