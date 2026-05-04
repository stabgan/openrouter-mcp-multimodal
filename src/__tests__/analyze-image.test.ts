import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import { handleAnalyzeImage } from '../tool-handlers/analyze-image.js';
import { prepareImageUrl } from '../tool-handlers/image-utils.js';

vi.mock('../tool-handlers/image-utils.js', () => ({
  prepareImageUrl: vi.fn(),
}));

function mockOpenAI(responseText: string) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: responseText }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  });
  const openai = { chat: { completions: { create } } } as unknown as OpenAI;
  return { openai, create };
}

describe('handleAnalyzeImage', () => {
  beforeEach(() => {
    vi.mocked(prepareImageUrl).mockReset();
  });

  it('rejects missing image_path', async () => {
    const { openai } = mockOpenAI('ignored');
    const r = await handleAnalyzeImage(
      { params: { arguments: { image_path: '' } } },
      openai,
      'default/model',
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('sends the prepared image URL to OpenAI', async () => {
    vi.mocked(prepareImageUrl).mockResolvedValue('data:image/png;base64,AAA');
    const { openai, create } = mockOpenAI('Looks good');
    const r = await handleAnalyzeImage(
      { params: { arguments: { image_path: 'local.png', question: 'What is this?' } } },
      openai,
      'default/model',
    );
    expect(r.isError).toBeFalsy();
    const call = create.mock.calls[0]![0];
    expect(call.model).toBe('default/model');
    const content = call.messages[0].content;
    expect(content[1].image_url.url).toBe('data:image/png;base64,AAA');
    expect((r as { _meta?: { usage?: unknown } })._meta?.usage).toEqual({
      prompt_tokens: 3,
      completion_tokens: 4,
      total_tokens: 7,
    });
  });

  it('maps blocked hosts to UPSTREAM_REFUSED', async () => {
    vi.mocked(prepareImageUrl).mockRejectedValue(new Error('Blocked host: 127.0.0.1'));
    const { openai } = mockOpenAI('ignored');
    const r = await handleAnalyzeImage(
      { params: { arguments: { image_path: 'http://127.0.0.1/img.png' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('maps size violations to RESOURCE_TOO_LARGE', async () => {
    vi.mocked(prepareImageUrl).mockRejectedValue(new Error('Image too large'));
    const { openai } = mockOpenAI('ignored');
    const r = await handleAnalyzeImage(
      { params: { arguments: { image_path: 'huge.png' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('RESOURCE_TOO_LARGE');
  });
});
