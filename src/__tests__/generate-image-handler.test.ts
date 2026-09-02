import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import OpenAI from 'openai';
import { handleGenerateImage } from '../tool-handlers/generate-image.js';

function mockOpenAI(response: unknown, throws?: Error): OpenAI {
  const create = vi.fn();
  if (throws) create.mockRejectedValue(throws);
  else create.mockResolvedValue(response);
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

describe('handleGenerateImage', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'mcp-gen-img-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_INPUT_DIR', sandbox);
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('returns INVALID_INPUT when prompt is empty', async () => {
    const r = await handleGenerateImage(
      { params: { arguments: { prompt: '   ' } } },
      mockOpenAI({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT for unsupported aspect_ratio', async () => {
    const r = await handleGenerateImage(
      { params: { arguments: { prompt: 'sunset', aspect_ratio: '99:1' } } },
      mockOpenAI({}),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT for non-positive max_tokens before calling the API', async () => {
    const openai = mockOpenAI({});
    const r = await handleGenerateImage(
      { params: { arguments: { prompt: 'sunset', max_tokens: 0 } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('INVALID_INPUT');
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('returns UNSAFE_PATH for save_path traversal before calling the API', async () => {
    const openai = mockOpenAI({});
    const r = await handleGenerateImage(
      { params: { arguments: { prompt: 'sunset', save_path: '../escape.png' } } },
      openai,
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UNSAFE_PATH');
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it('returns image content when the model emits a data URL', async () => {
    const openai = mockOpenAI({
      choices: [
        {
          message: {
            images: [{ image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }],
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const r = await handleGenerateImage({ params: { arguments: { prompt: 'a red dot' } } }, openai);

    expect(r.isError).toBeFalsy();
    expect(r.content).toEqual([{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }]);
    expect((r as { _meta: { usage: { total_tokens: number } } })._meta.usage?.total_tokens).toBe(
      30,
    );
  });

  it('returns UPSTREAM_REFUSED when the model returns text but no image', async () => {
    const r = await handleGenerateImage(
      {
        params: { arguments: { prompt: 'a cat' } },
      },
      mockOpenAI({
        choices: [
          {
            message: { content: 'I cannot generate images right now.' },
            finish_reason: 'stop',
          },
        ],
      }),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('writes save_path when provided and returns saved path text', async () => {
    const savePath = 'out.png';
    const openai = mockOpenAI({
      choices: [
        {
          message: {
            images: [{ image_url: { url: 'data:image/png;base64,QUJD' } }],
          },
        },
      ],
    });

    const r = await handleGenerateImage(
      { params: { arguments: { prompt: 'dot', save_path: savePath } } },
      openai,
    );

    expect(r.isError).toBeFalsy();
    const abs = path.join(await fs.realpath(sandbox), savePath);
    expect(await fs.readFile(abs)).toEqual(Buffer.from('ABC'));
    expect(r.content?.[0]).toMatchObject({ type: 'text' });
    expect(String(r.content?.[0]?.text)).toContain(abs);
    expect(r.content).toHaveLength(1);
    expect(r.content.some((c) => c.type === 'image')).toBe(false);
  });

  it('returns UPSTREAM_REFUSED when decoded image payload is empty', async () => {
    const r = await handleGenerateImage(
      { params: { arguments: { prompt: 'dot' } } },
      mockOpenAI({
        choices: [
          {
            message: {
              images: [{ image_url: { url: 'data:image/png;base64,' } }],
            },
          },
        ],
      }),
    );
    expect(r.isError).toBe(true);
    expect((r as { _meta: { code: string } })._meta.code).toBe('UPSTREAM_REFUSED');
  });

  it('returns text-only hint when inline image exceeds byte ceiling', async () => {
    vi.stubEnv('OPENROUTER_IMAGE_INLINE_MAX_BYTES', '4096');
    const big = Buffer.alloc(5000, 0xab);
    const r = await handleGenerateImage(
      { params: { arguments: { prompt: 'big dot' } } },
      mockOpenAI({
        choices: [
          {
            message: {
              images: [{ image_url: { url: `data:image/png;base64,${big.toString('base64')}` } }],
            },
          },
        ],
      }),
    );
    expect(r.isError).toBeFalsy();
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.type).toBe('text');
    expect(String(r.content[0]?.text)).toMatch(/Too large to inline/i);
    expect(r.content.some((c) => c.type === 'image')).toBe(false);
  });
});
