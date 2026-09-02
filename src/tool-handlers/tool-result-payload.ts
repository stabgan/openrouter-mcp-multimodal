export type InlineMediaKind = 'image' | 'audio' | 'video';

type TextContent = { type: 'text'; text: string };
type ImageContent = { type: 'image'; mimeType: string; data: string };
type AudioContent = { type: 'audio'; mimeType: string; data: string };
type ResourceContent = {
  type: 'resource';
  resource: { uri: string; mimeType?: string; blob: string };
};
export type BinaryToolContent = TextContent | ImageContent | AudioContent | ResourceContent;

export interface BinaryArtifact {
  kind: InlineMediaKind;
  buffer: Buffer;
  mimeType: string;
}

export interface BuildBinaryToolResultOptions {
  savedPath?: string | null;
  /** Overrides default saved/too-large message */
  summaryText?: string;
  /** Shown alongside inline media when not using inlineOnly */
  prefixText?: string;
  /** When inline fits and no save_path: return media block only (image UX) */
  inlineOnly?: boolean;
  remoteUrl?: string;
  meta?: Record<string, unknown>;
  maxInlineBytes?: number;
}

const DEFAULT_INLINE_MAX_BYTES = 1024 * 1024;
const DEFAULT_VIDEO_INLINE_MAX_BYTES = 10 * 1024 * 1024;
const INLINE_VIDEO_URI = 'inline://openrouter-mcp-multimodal/video';

const KIND_ENV_KEYS: Record<InlineMediaKind, string> = {
  image: 'OPENROUTER_IMAGE_INLINE_MAX_BYTES',
  audio: 'OPENROUTER_AUDIO_INLINE_MAX_BYTES',
  video: 'OPENROUTER_VIDEO_INLINE_MAX_BYTES',
};

const KIND_DEFAULT_BYTES: Record<InlineMediaKind, number> = {
  image: DEFAULT_INLINE_MAX_BYTES,
  audio: DEFAULT_INLINE_MAX_BYTES,
  video: DEFAULT_VIDEO_INLINE_MAX_BYTES,
};

function readEnvInlineMaxBytes(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getMaxInlineBytes(kind: InlineMediaKind): number {
  const globalFallback = readEnvInlineMaxBytes(
    'OPENROUTER_INLINE_MAX_BYTES',
    KIND_DEFAULT_BYTES[kind],
  );
  return readEnvInlineMaxBytes(KIND_ENV_KEYS[kind], globalFallback);
}

function kindLabel(kind: InlineMediaKind): string {
  switch (kind) {
    case 'image':
      return 'Image';
    case 'audio':
      return 'Audio';
    case 'video':
      return 'Video';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function buildInlineBlock(
  kind: InlineMediaKind,
  mimeType: string,
  data: string,
  remoteUrl?: string,
): Exclude<BinaryToolContent, TextContent> {
  if (kind === 'video') {
    return {
      type: 'resource',
      resource: {
        uri: remoteUrl ?? INLINE_VIDEO_URI,
        mimeType,
        blob: data,
      },
    };
  }
  return { type: kind, mimeType, data };
}

export function buildBinaryToolResult(
  artifact: BinaryArtifact,
  opts: BuildBinaryToolResultOptions = {},
): { content: BinaryToolContent[]; _meta: Record<string, unknown> } {
  const { kind, buffer, mimeType } = artifact;
  const maxInline = opts.maxInlineBytes ?? getMaxInlineBytes(kind);
  const meta: Record<string, unknown> = {
    ...opts.meta,
    mime: mimeType,
    size_bytes: buffer.length,
  };

  if (opts.savedPath) {
    const text =
      opts.summaryText ??
      `${kindLabel(kind)} saved to: ${opts.savedPath} (${buffer.length} bytes, ${mimeType})`;
    return {
      content: [{ type: 'text', text }],
      _meta: { ...meta, save_path: opts.savedPath },
    };
  }

  if (buffer.length <= maxInline) {
    const data = buffer.toString('base64');
    if (opts.inlineOnly) {
      return {
        content: [buildInlineBlock(kind, mimeType, data, opts.remoteUrl)],
        _meta: meta,
      };
    }
    const text =
      opts.prefixText ?? `${kindLabel(kind)} generated (${buffer.length} bytes, ${mimeType}).`;
    return {
      content: [textBlock(text), buildInlineBlock(kind, mimeType, data, opts.remoteUrl)],
      _meta: meta,
    };
  }

  const urlHint = opts.remoteUrl ? ` URL: ${opts.remoteUrl}` : '';
  return {
    content: [
      {
        type: 'text',
        text:
          opts.summaryText ??
          `${kindLabel(kind)} generated (${buffer.length} bytes, ${mimeType}). Too large to inline; pass save_path to persist.${urlHint}`,
      },
    ],
    _meta: meta,
  };
}

function textBlock(text: string): TextContent {
  return { type: 'text', text };
}
