/**
 * Helper for building MCP tool responses that carry structured data
 * alongside the legacy text representation.
 *
 * Per MCP spec 2025-06-18 §5.2.6-7, when a tool has an `outputSchema`
 * the response SHOULD include `structuredContent` (the typed object)
 * AND, for backwards compatibility with clients that don't parse that
 * field, `content` with a serialized JSON text block.
 *
 * Consumers use `buildStructuredResult(data, meta?)` and get back the
 * full `{ content, structuredContent, _meta }` shape.
 */
import { SERVER_VERSION } from '../version.js';

export interface StructuredResult<T = unknown> {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: T;
  _meta: Record<string, unknown>;
}

/**
 * Wrap a JSON-serializable object in the MCP-spec dual-representation
 * format. `meta` is merged on top of the default `server_version` stamp.
 */
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
