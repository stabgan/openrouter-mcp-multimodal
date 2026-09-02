import { describe, it, expect, vi, afterEach } from 'vitest';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildBinaryToolResult, getMaxInlineBytes } from '../tool-handlers/tool-result-payload.js';
import { buildStructuredResult } from '../tool-handlers/structured-output.js';
import { toolError, ErrorCode } from '../errors.js';

function expectValidCallToolResult(result: unknown): void {
  const parsed = CallToolResultSchema.safeParse(result);
  expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(
    true,
  );
}

describe('buildBinaryToolResult', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns text only when savedPath is set (no inline duplication)', () => {
    const buf = Buffer.from('hello');
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: buf, mimeType: 'image/png' },
      { savedPath: '/tmp/out.png', meta: { server_version: '1.0.0' } },
    );
    expect(r.content).toEqual([
      { type: 'text', text: 'Image saved to: /tmp/out.png (5 bytes, image/png)' },
    ]);
    expect(r._meta.save_path).toBe('/tmp/out.png');
    expect(r._meta.size_bytes).toBe(5);
  });

  it('uses custom summaryText when saved', () => {
    const r = buildBinaryToolResult(
      { kind: 'audio', buffer: Buffer.from('x'), mimeType: 'audio/wav' },
      { savedPath: '/tmp/a.wav', summaryText: 'Audio saved to: /tmp/a.wav\nTranscript: hi' },
    );
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.text).toContain('Transcript');
  });

  it('inlines media when under limit and inlineOnly is true', () => {
    const buf = Buffer.from('abc');
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: buf, mimeType: 'image/png' },
      { inlineOnly: true, maxInlineBytes: 1024 },
    );
    expect(r.content).toEqual([
      { type: 'image', mimeType: 'image/png', data: buf.toString('base64') },
    ]);
  });

  it('returns text + media when under limit without inlineOnly', () => {
    const buf = Buffer.from('abc');
    const r = buildBinaryToolResult(
      { kind: 'audio', buffer: buf, mimeType: 'audio/wav' },
      { maxInlineBytes: 1024 },
    );
    expect(r.content).toHaveLength(2);
    expect(r.content[0]?.type).toBe('text');
    expect(r.content[1]).toMatchObject({ type: 'audio', mimeType: 'audio/wav' });
  });

  it('omits inline media when over limit without save_path', () => {
    const buf = Buffer.alloc(2000, 1);
    const r = buildBinaryToolResult(
      { kind: 'image', buffer: buf, mimeType: 'image/png' },
      { maxInlineBytes: 100, remoteUrl: 'https://example.com/img.png' },
    );
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.type).toBe('text');
    expect(r.content[0]?.text).toContain('Too large to inline');
    expect(r.content[0]?.text).toContain('save_path');
    expect(r.content[0]?.text).toContain('https://example.com/img.png');
  });

  it('getMaxInlineBytes respects per-kind env override', () => {
    vi.stubEnv('OPENROUTER_VIDEO_INLINE_MAX_BYTES', '9999');
    expect(getMaxInlineBytes('video')).toBe(9999);
  });

  describe('getMaxInlineBytes env parsing', () => {
    const IMAGE_DEFAULT = 1024 * 1024;
    const VIDEO_DEFAULT = 10 * 1024 * 1024;

    it('uses per-kind defaults when env is unset', () => {
      expect(getMaxInlineBytes('image')).toBe(IMAGE_DEFAULT);
      expect(getMaxInlineBytes('audio')).toBe(IMAGE_DEFAULT);
      expect(getMaxInlineBytes('video')).toBe(VIDEO_DEFAULT);
    });

    it('respects explicit zero (never inline)', () => {
      vi.stubEnv('OPENROUTER_IMAGE_INLINE_MAX_BYTES', '0');
      expect(getMaxInlineBytes('image')).toBe(0);
    });

    it('respects small explicit values below the old 4096 floor', () => {
      vi.stubEnv('OPENROUTER_IMAGE_INLINE_MAX_BYTES', '1024');
      expect(getMaxInlineBytes('image')).toBe(1024);
    });

    it('respects large explicit values', () => {
      vi.stubEnv('OPENROUTER_AUDIO_INLINE_MAX_BYTES', '5000000');
      expect(getMaxInlineBytes('audio')).toBe(5_000_000);
    });

    it('falls back on junk input', () => {
      vi.stubEnv('OPENROUTER_INLINE_MAX_BYTES', 'not-a-number');
      vi.stubEnv('OPENROUTER_IMAGE_INLINE_MAX_BYTES', 'also-bad');
      expect(getMaxInlineBytes('image')).toBe(IMAGE_DEFAULT);
    });

    it('applies generic env before per-kind override', () => {
      vi.stubEnv('OPENROUTER_INLINE_MAX_BYTES', '2048');
      expect(getMaxInlineBytes('audio')).toBe(2048);
      vi.stubEnv('OPENROUTER_AUDIO_INLINE_MAX_BYTES', '512');
      expect(getMaxInlineBytes('audio')).toBe(512);
    });

    it('never inlines non-empty buffers when max is zero', () => {
      const buf = Buffer.from('abc');
      vi.stubEnv('OPENROUTER_IMAGE_INLINE_MAX_BYTES', '0');
      const r = buildBinaryToolResult(
        { kind: 'image', buffer: buf, mimeType: 'image/png' },
        { inlineOnly: true },
      );
      expect(r.content).toHaveLength(1);
      expect(r.content[0]?.type).toBe('text');
      expect(r.content[0]?.text).toContain('Too large to inline');
    });
  });

  it('maps inline video to MCP resource blocks', () => {
    const buf = Buffer.from('mp4');
    const r = buildBinaryToolResult(
      { kind: 'video', buffer: buf, mimeType: 'video/mp4' },
      { inlineOnly: true, maxInlineBytes: 1024, remoteUrl: 'https://example.com/v.mp4' },
    );
    expect(r.content[0]).toMatchObject({
      type: 'resource',
      resource: {
        uri: 'https://example.com/v.mp4',
        mimeType: 'video/mp4',
        blob: buf.toString('base64'),
      },
    });
    expectValidCallToolResult(r);
  });

  it('uses synthetic inline URI when remoteUrl is omitted', () => {
    const buf = Buffer.from('mp4');
    const r = buildBinaryToolResult(
      { kind: 'video', buffer: buf, mimeType: 'video/mp4' },
      { inlineOnly: true, maxInlineBytes: 1024 },
    );
    expect(r.content[0]).toMatchObject({
      type: 'resource',
      resource: {
        uri: 'inline://openrouter-mcp-multimodal/video',
        mimeType: 'video/mp4',
        blob: buf.toString('base64'),
      },
    });
    expectValidCallToolResult(r);
  });

  it('validates image, audio, and text-only results against CallToolResultSchema', () => {
    const image = buildBinaryToolResult(
      { kind: 'image', buffer: Buffer.from('x'), mimeType: 'image/png' },
      { inlineOnly: true, maxInlineBytes: 1024 },
    );
    const audio = buildBinaryToolResult(
      { kind: 'audio', buffer: Buffer.from('x'), mimeType: 'audio/wav' },
      { maxInlineBytes: 1024 },
    );
    const saved = buildBinaryToolResult(
      { kind: 'video', buffer: Buffer.from('x'), mimeType: 'video/mp4' },
      { savedPath: '/tmp/out.mp4' },
    );
    for (const r of [image, audio, saved]) {
      expectValidCallToolResult(r);
    }
  });
});

describe('CallToolResultSchema conformance', () => {
  it('accepts structured tool results and tool errors', () => {
    expectValidCallToolResult(buildStructuredResult({ ok: true }));
    expectValidCallToolResult(toolError(ErrorCode.INVALID_INPUT, 'bad input'));
  });
});
