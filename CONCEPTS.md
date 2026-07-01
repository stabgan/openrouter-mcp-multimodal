# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Input path sandbox

Caller-supplied **local file paths** for reading (`analyze_*`, `generate_image` refs, video frames) must resolve inside `OPENROUTER_INPUT_DIR` (fallback: `OPENROUTER_OUTPUT_DIR`, then `cwd`) via `resolveSafeInputPath`. Traversal and absolute paths outside the root return `UNSAFE_PATH`.

## Output path sandbox

Caller-supplied **save paths** for writing generated media must resolve inside `OPENROUTER_OUTPUT_DIR` (default `cwd`) via `resolveSafeOutputPath`. Same `OPENROUTER_ALLOW_UNSAFE_PATHS=1` legacy bypass as input sandbox.

## MCP tool handler

One exported `handle*` function per MCP tool, registered in `tool-handlers.ts`. Handlers map MCP arguments to OpenRouter API calls and return MCP content + `_meta` (including `ErrorCode` on failure).

## ErrorCode

Closed taxonomy in `errors.ts` (`UNSAFE_PATH`, `INVALID_INPUT`, `UPSTREAM_HTTP`, …). Every tool error carries `_meta.code` for agent routing.
