import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildBinaryToolResult, getMaxInlineBytes } from '../tool-handlers/tool-result-payload.js';

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
  });
});
