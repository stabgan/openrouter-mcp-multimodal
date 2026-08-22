/** Build MCP tool responses with `structuredContent` plus legacy JSON text. */
import { SERVER_VERSION } from '../version.js';

export interface StructuredResult<T = unknown> {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: T;
  _meta: Record<string, unknown>;
}

/** Wrap JSON-serializable data in MCP dual-representation format. */
export function buildStructuredResult<T>(
  data: T,
  meta: Record<string, unknown> = {},
): StructuredResult<T> {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    _meta: { server_version: SERVER_VERSION, ...meta },
  };
}

/** Read typed JSON from an MCP tool result (structuredContent or legacy text). */
export function readToolPayload<T = unknown>(result: {
  structuredContent?: T;
  content?: Array<{ type: string; text?: string }>;
}): T {
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const text = result.content?.[0]?.text;
  if (text === undefined) {
    throw new Error('tool result has no structuredContent or content text');
  }
  return JSON.parse(text) as T;
}
