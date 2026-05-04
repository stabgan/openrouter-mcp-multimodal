/**
 * Single source of truth for our server version. Exposed via
 * `_meta.server_version` on every successful tool response and returned
 * by the `health_check` tool.
 *
 * Bumped in lockstep with package.json / server.json / smithery.yaml /
 * scripts/build-manifest.mjs during release prep.
 */
export const SERVER_VERSION = '4.5.1';

/**
 * MCP protocol version our SDK speaks. Hardcoded to match the version
 * bundled with `@modelcontextprotocol/sdk`; update when upgrading the
 * SDK major. Surfaced by `health_check` so ops can confirm spec level
 * at runtime.
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';
