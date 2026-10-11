# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Input path sandbox

Caller-supplied **local file paths** for reading (`analyze_*`, `generate_image` refs, video frames) must resolve inside `OPENROUTER_INPUT_DIR` (fallback: `OPENROUTER_OUTPUT_DIR`, then `cwd`) via `resolveSafeInputPath`. Traversal and absolute paths outside the root return `UNSAFE_PATH`.

## Output path sandbox

Caller-supplied **save paths** for writing generated media must resolve inside `OPENROUTER_OUTPUT_DIR` (default `cwd`) via `resolveSafeOutputPath`. Same `OPENROUTER_ALLOW_UNSAFE_PATHS=1` legacy bypass as input sandbox.

## Binary tool result policy (v4.7.0+)

When a generate tool sets **`save_path`**, the MCP response is **text-only** with `_meta.save_path` — no inline base64. Without `save_path`, inline image/audio/video is returned only under byte ceilings (defaults: 1 MiB image/audio, 10 MiB video; env `OPENROUTER_*_INLINE_MAX_BYTES`). Implemented in `tool-handlers/tool-result-payload.ts`.

## MCP tool handler

One exported `handle*` function per MCP tool, registered in `tool-handlers.ts`. Handlers map MCP arguments to OpenRouter API calls and return MCP content + `_meta` (including `ErrorCode` on failure).

## ErrorCode

Closed taxonomy in `errors.ts` (`UNSAFE_PATH`, `INVALID_INPUT`, `UPSTREAM_HTTP`, …). Every tool error carries `_meta.code` for agent routing.

## Embeddings

The `embed_text` tool calls `POST /api/v1/embeddings` to generate vector embeddings from text. Supports 37+ models (text-embedding-3-small/large, Voyage, Cohere Embed, Nomic, Jina, etc.). Returns embedding arrays for RAG, semantic search, and clustering. Optional `dimensions` parameter for models that support truncated embeddings.

## Decisions (System One)

The `decide` tool calls `POST /api/alpha/decisions` — a non-v1 alpha endpoint for structured decisions. System One models (typesafe/jev-1.13, upstage/solar-decide, microsoft/decision-1) return calibrated probabilities instead of generated text. Three question types: **noul** (yes/no with confidence), **choice** (classify into categories), **score** (ordinal rubric). Each question carries `instructions` and `criteria`.

## Async chat completion

`start_chat_completion` fires a background chat request and returns a `job_id` immediately. `get_chat_completion_status` polls by `job_id`. Designed for reasoning models (DeepSeek R1, Claude Opus) or remote MCP bridges with short timeouts. Job state is held in memory; the `OPENROUTER_ASYNC_JOBS_MEMORY_MAX` env var caps the store (default 200, LRU eviction). Disk-based result paths resolve only under `OPENROUTER_OUTPUT_DIR/openrouter-jobs/`.

## Model suffixes

OpenRouter routing suffixes appended to model slugs: `:nitro` (fastest provider), `:floor` (cheapest), `:free` (zero-cost tier), `:online` (web-search grounded), `:exacto` (tool-accuracy optimized). Passed through to OpenRouter's routing layer verbatim.

## Provider routing

Per-request or env-level control over which OpenRouter providers handle a call. Parameters: `sort` (price/throughput/latency), `only`/`ignore` (allow/block lists), `order` (preference), `quantizations`, `require_parameters`, `data_collection` (allow/deny), `allow_fallbacks`. Env defaults in `provider-routing.ts`; per-request `provider` param on tools overrides them.

## Response caching

`cache`, `cache_ttl`, `cache_clear` parameters on tools map to `X-OpenRouter-Cache*` HTTP headers via `cache.ts`. `OPENROUTER_CACHE_RESPONSES=true` enables caching server-wide. Cache hits cost zero tokens.

## Tool icons

SVG data-URI icons for each tool, registered in `tool-icons.ts` (MCP 2025-11-25 spec). Icons are embedded directly in tool definitions so MCP clients can display them without additional fetches. Must stay in sync with `TOOL_NAMES`.

## Multi-model fusion

`fusion: true` on `chat_completion` enables `openrouter:fusion` — multiple models answer in parallel and an analyst model synthesizes a consensus response. Higher quality but ~2–5× latency. Useful for critical decisions where a single model's judgment is insufficient.

## Subagent delegation

`subagent: true` (or `{ model: "..." }`) on `chat_completion` enables `openrouter:subagent` — the primary model can delegate subtasks to a smaller, cheaper worker model mid-generation. Reduces cost on busywork without sacrificing quality on the main task.

## Response healing

`response_healing: true` on `chat_completion` enables `openrouter:response_healing` — auto-fixes malformed JSON output (missing brackets, trailing commas, markdown wrappers). Reduces JSON defect rates by 80%+. Complementary to `response_format: { "type": "json_object" }`.

## Reasoning effort

`reasoning_effort` param on `chat_completion` controls reasoning depth for thinking models (DeepSeek R1, Gemini Thinking, Claude Opus). Common values: `low`, `medium`, `high`. Works alongside `include_reasoning: true` which surfaces the chain-of-thought trace on `_meta.reasoning`.

## Web search (online)

`online: true` on `chat_completion` enables OpenRouter's Exa-backed web-search plugin ($4 / 1000 results). `web_max_results` caps the result count (default 5). `web_blocked_domains` excludes specific sites. Equivalent to appending `:online` suffix to the model slug.

## Structured output

`response_format` on `chat_completion` controls output structure: `{ "type": "json_object" }` for freeform JSON, `{ "type": "json_schema", "json_schema": { ... } }` for schema-constrained output. MCP 2025-11-25 `outputSchema` on catalog tools (search_models, validate_model, etc.) provides typed responses for programmatic use.

## SSRF guard

All outbound URL fetches in `fetch-utils.ts` block private/reserved IPv4 ranges (loopback, link-local, RFC 1918, CGNAT) before connecting. Prevents server-side request forgery when callers pass attacker-controlled URLs to analyze tools.
