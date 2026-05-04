import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import { handleAnalyzeAudio } from '../tool-handlers/analyze-audio.js';
import { prepareAudioData } from '../tool-handlers/audio-utils.js';

vi.mock('../tool-handlers/audio-utils.js', () => ({
  prepareAudioData: vi.fn(),
}));

function mockOpenAI(responseText: string) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: responseText }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
  });
  const openai = { chat: { completions: { create } } } as unknown as OpenAI;
  return { openai, create };
}

describe('handleAnalyzeAudio', () => {
  beforeEach(() => {
    vi.mocked(prepareAudioData).mockReset();
  });

  it('rejects missing audio_path', async () => {
    const { openai } = mockOpenAI('ignored');
    const r = await handleAnalyzeAudio(
      { params: { arguments: { audio_path: '' } } },
      openai,
      'default/model',
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('sends input_audio content to OpenAI', async () => {
    vi.mocked(prepareAudioData).mockResolvedValue({ data: 'AAA', format: 'wav' });
    const { openai, create } = mockOpenAI('Heard it');
    const r = await handleAnalyzeAudio(
      {
        params: {
          arguments: { audio_path: 'clip.wav', question: 'What do you hear?' },
        },
      },
      openai,
      'custom/model',
    );
    expect(r.isError).toBeFalsy();
    const call = create.mock.calls[0]![0];
    expect(call.model).toBe('custom/model');
    const content = call.messages[0].content;
    expect(content[1].input_audio).toEqual({ data: 'AAA', format: 'wav' });
    expect((r as { _meta?: { usage?: unknown } })._meta?.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 6,
      total_tokens: 11,
    });
  });

  it('maps unsupported formats to UNSUPPORTED_FORMAT', async () => {
    vi.mocked(prepareAudioData).mockRejectedValue(
      new Error('Unsupported audio format for file: clip.txt'),
    );
    const { openai } = mockOpenAI('ignored');
    const r = await handleAnalyzeAudio(
      { params: { arguments: { audio_path: 'clip.txt' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UNSUPPORTED_FORMAT');
  });
});
