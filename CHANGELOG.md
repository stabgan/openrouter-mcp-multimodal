# Changelog

All notable changes to `@stabgan/openrouter-mcp-multimodal` are recorded here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.5.0] — 2026-05-04

Major feature release adding 18 enhancements across OpenRouter platform parity, MCP 2025-06-18 spec compliance, and research-driven improvements. Fully backwards compatible.

### Added — OpenRouter platform parity
- **Response caching via `X-OpenRouter-Cache`.** New `cache`, `cache_ttl`, `cache_clear` params on `chat_completion` + analyze_* tools. Zero tokens billed on cache hits, 80-300ms latency vs seconds. Server-wide default via `OPENROUTER_CACHE_RESPONSES=1`. `_meta.cache = {status, age, ttl}` surfaced from response headers.
- **Reasoning tokens passthrough.** New `include_reasoning` param on `chat_completion`; when set, upstream reasoning trace surfaces on `_meta.reasoning`. Supports DeepSeek R1, Gemini Thinking, Opus 4.7. Server-wide default via `OPENROUTER_INCLUDE_REASONING=1`.
- **Native finish reason.** `_meta.native_finish_reason` alongside normalized `_meta.finish_reason` on every text-returning tool.
- **`:exacto` suffix documented.** `chat_completion` description + field docstring list `:nitro`, `:floor`, `:exacto` (Auto Exacto reduces tool-call errors ~80% on top tool-calling models).
- **Web search plugin.** New `online: boolean` + `web_max_results: number` on `chat_completion` — injects OpenRouter's Exa-backed plugin (`$4 / 1000 results`).
- **`cache_control` breakpoints on analyze_* tools.** New `cache_input: boolean` on `analyze_image`, `analyze_audio`, `analyze_video`. Attaches `cache_control: {type: 'ephemeral'}` to the media block so Anthropic Claude / Gemini 2.5+ prompt-cache it — 10x savings on repeat analysis (Anthropic), 4x (Gemini).
- **`rerank_documents` tool.** New tool backed by OpenRouter's `/rerank` endpoint. Cohere + Fireworks rerankers. Inputs: `query`, `documents[]`, optional `model` (default `cohere/rerank-english-v3.0`), `top_n`, `return_documents`.

### Added — MCP 2025-06-18 spec compliance
- **Structured outputs + `outputSchema`.** `validate_model`, `get_model_info`, `search_models`, `rerank_documents`, `health_check` now emit `structuredContent` with typed JSON + declared `outputSchema`, per MCP §5.2.6-7. Agents can validate responses structurally.
- **Progress notifications.** `generate_video` now emits `notifications/progress` on every poll tick when the client passes a `progressToken` in request `_meta`. Per MCP basic/utilities/progress spec. Agents can show "processing 45%" to users.
- **`title` + `openWorldHint: true` on every tool.** Human-readable display names for clients that surface them; open-world hint reflects that every one of our tools hits external APIs.

### Added — research-driven improvements
- **Failure-mode + inter-tool documentation on every tool.** Per arxiv 2602.18764 (Schema-Guided Dialogue / MCP convergence), every tool description now includes explicit "Fails when:" (ErrorCode triggers) and "Works with:" (related tools in a workflow) sections. Research predicts ~10-15% improvement in tool-selection accuracy.
- **`generate_video_from_image`.** New narrower tool wrapping `generate_video` for image-to-video workflows. Per arxiv 2511.03497: fewer parameters = higher tool-call hit rate.
- **`content_is_untrusted: true` hint on analyze_* output.** Inspired by ClawGuard (arxiv 2604.11790) and tool-result-parsing defenses (2601.04795). Flags model output derived from potentially attacker-controlled media so downstream agents can treat it as data, not instructions.
- **Audit logging for paid operations.** New `logger.audit()` method that bypasses the log-level filter. Emitted from `generate_video`, `generate_audio`, `generate_image` with model, 80-char prompt preview (PII boundary), and cost-shape hints. Enables unintended-spend tracing via `docker logs`.
- **Structured error metadata.** `toolError()` accepts optional `suggestions: string[]` and `retry_after_seconds: number`. Agents get concrete next-step options instead of raw strings to interpret. Inspired by Apigene's production MCP best-practice guide.
- **`health_check` tool.** Verifies API-key validity, OpenRouter reachability, and returns server + protocol versions. `{ ok, server_version, protocol_version, api_key_valid, models_cached }`.
- **`search_models` pagination.** New `offset` + `next_offset` + `has_more` + `total` fields in the result. Safely walk large result sets.
- **`_meta.server_version` stamp.** Every successful tool response carries `server_version: "4.5.0"` for debuggability.

### Changed
- Rewrote every tool description (11 existing + 2 new) with explicit "Fails when:" and "Works with:" sections.
- `ModelCache.search()` gains an `all: true` escape hatch for pagination (returns the full filtered set, no limit applied).
- `completion-utils.ts`'s `ExtractedText` interface now carries `nativeFinishReason` + `reasoning` fields, surfaced by the new `buildCompletionMeta()` helper.

### Added — tests
- 11 new test files: `cache`, `structured-output`, `structured-tools`, `rerank`, `health-check`, `generate-video-from-image`, `audit-log`, `progress-notifications`, `pagination`, `content-untrusted`, `error-suggestions`. Test count rises from 205 to 250+.

### Backwards compatibility
All changes are additive. Every new field is optional. No existing caller breaks.

### Citations
- Anthropic announcement: [Response caching](https://openrouter.ai/announcements/response-caching)
- Arxiv [2602.18764](https://arxiv.org/abs/2602.18764) — Schema-Guided Dialogue / MCP convergence principles
- Arxiv [2511.03497](https://arxiv.org/abs/2511.03497) — ROSBag MCP, tool-call accuracy vs parameter count
- Arxiv [2604.11790](https://arxiv.org/abs/2604.11790) — ClawGuard, tool-call boundary enforcement
- Arxiv [2601.04795](https://arxiv.org/abs/2601.04795) — Tool result parsing defense against prompt injection
- Apigene's production MCP best-practice guide (March 2026)
- Phil Schmid, "MCP is Not the Problem, It's your Server" (January 2026)
- MCP spec [2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/) — structured outputs, progress notifications

## [4.0.1] — 2026-05-04

Security + hygiene patch from an independent audit pass. Two security fixes (one HIGH, one MEDIUM) and the smithery.yaml manifest catching up to v4.

### Fixed
- **HIGH — `generate_video` read arbitrary local files without sandbox.** `first_frame_image`, `last_frame_image`, and `reference_images` did a raw `fs.readFile(source)` with no path check, so an MCP caller could set e.g. `first_frame_image: "/etc/passwd"` or `reference_images: ["/Users/victim/.ssh/id_rsa"]` and exfiltrate arbitrary files to OpenRouter inside the video-job body. `generate_image`'s `input_images` field already had the correct `resolveInputImage` sandbox; this fix extracts that logic into a shared `resolveSafeInputPath` helper in `path-safety.ts` and routes `generate_video`'s image inputs through it. Sandbox violations now return `UNSAFE_PATH` (previously would have silently succeeded). `OPENROUTER_ALLOW_UNSAFE_PATHS=1` legacy bypass still works.
- **MEDIUM — Docker image ran as root.** The final stage had no `USER` directive, so any process-level compromise inside the container ran as uid 0. Added an unprivileged `app` user in the runtime stage and `USER app` before `CMD`. Rebuilt with `--chown=app:app` on the `COPY` lines so file permissions are correct from the start.
- **MEDIUM — `smithery.yaml` stale at v3.0.0.** Bumped to match the package version, added all seven `OPENROUTER_PROVIDER_*` env vars plus `OPENROUTER_MAX_TOKENS` and `OPENROUTER_INPUT_DIR` to both `configSchema.properties` and `config.env`. Smithery UI now shows the full v4 knob set.

### Changed
- **LOW — `OPENROUTER_PROVIDER_ORDER` malformed JSON now logs a warning** instead of silently dropping, so operators get a signal when their env var isn't being honored. Other `OPENROUTER_PROVIDER_*` fields keep the silent-drop policy since their parsers can't usefully distinguish "user intended X" from "user typed garbage."
- **`.gitignore`** now covers `.smithery/` and `.smithery*` patterns alongside the other CLI credential paths (`.mcpregistry_*`).

### Added
- **`src/tool-handlers/path-safety.ts:resolveSafeInputPath`** — new shared helper for input-path sandboxing. Mirrors `resolveSafeOutputPath`'s semantics but for reads only (no mkdir, no directory creation).
- **6 new tests** in `src/__tests__/path-safety-input.test.ts` covering the shared helper (relative accept, absolute inside root, traversal reject, `/etc/passwd` reject, `OPENROUTER_OUTPUT_DIR` fallback, `OPENROUTER_ALLOW_UNSAFE_PATHS=1` bypass). Test count now 205 / 205 green.

## [4.0.0] — 2026-05-04

### License
- **Relicensed from MIT to Apache-2.0.** Apache 2.0 is a permissive superset of MIT's terms with an explicit patent grant and trademark clause. The `LICENSE` file now carries the canonical Apache 2.0 text. The `Apache-2.0` SPDX identifier is set in `package.json`, the `org.opencontainers.image.licenses` Dockerfile label, and the README badge.

### Added — provider routing parity
Brings `chat_completion` up to full parity with [`@mcpservers/openrouterai`](https://www.npmjs.com/package/@mcpservers/openrouterai) on OpenRouter's provider-routing controls. See [https://openrouter.ai/docs/features/provider-routing](https://openrouter.ai/docs/features/provider-routing).

- **`provider` tool-arg on `chat_completion`** accepting the full set of OpenRouter routing options: `quantizations`, `ignore`, `sort` (price / throughput / latency), `order`, `require_parameters`, `data_collection` (allow / deny), `allow_fallbacks`. Merges on top of env-var defaults so callers can override per-request.
- **Model variant suffixes** — `:nitro` (fastest variant) and `:floor` (cheapest variant) pass through natively because OpenRouter parses them server-side. Documented in the README and the `chat_completion` schema.
- **`OPENROUTER_MAX_TOKENS` env var** — default `max_tokens` cap when the tool call doesn't set one. Useful on low-credit and free-tier accounts to avoid the full-context-window reservation that 402s Gemini image models.
- **Seven `OPENROUTER_PROVIDER_*` env vars** — one per provider-routing field. Default values apply to every `chat_completion` call; tool-arg overrides still win.
- **`src/tool-handlers/provider-routing.ts`** — shared helper that parses env defaults (with CSV + JSON-array fallback for `OPENROUTER_PROVIDER_ORDER`), merges overrides, and emits the OpenRouter request body.
- **18 new unit tests** covering env parsing, override merging, body assembly, and `max_tokens` resolution. Total test count 199 / 199 green.

### Changed
- `chat_completion` tool description now advertises the routing and suffix features.
- README: first paragraph, env var table, and Usage Examples updated with provider-routing examples; License section notes the Apache 2.0 transition.
- `.env.example` documents every new env var with inline comments.
- MCP Registry `server.json` lists the eight new env vars so the Smithery / MCP Registry config UI surfaces them automatically.

### Compatibility
- Fully backward-compatible for callers who don't use `provider` or any `OPENROUTER_PROVIDER_*` env var: same request body, same behavior. Only the license file and the chat_completion schema expand.

## [3.2.0] — 2026-05-03

### Added
- **`generate_image` reference images** ([#15](https://github.com/stabgan/openrouter-mcp-multimodal/issues/15), [#16](https://github.com/stabgan/openrouter-mcp-multimodal/pull/16) by [@ahmadsl](https://github.com/ahmadsl)). New optional `input_images: string[]` field on `generate_image`. Each entry is a local file path, an `http(s)://` URL, or a `data:image/...;base64,...` URL. When provided, the user message becomes a multimodal `ChatCompletionContentPart[]`: a text preamble + one `image_url` block per ref, in input order. Enables character/style consistency, image-to-image, and iterative refinement on chat-image models (Gemini Nano Banana, `openai/gpt-5.4-image-2`).
- **`generate_image` modalities override.** New optional `modalities: string[]` field on `generate_image`. Defaults to the `["image","text"]` value v3.1.0 hardcodes; provide e.g. `["text"]` to suppress image output for inspection / captioning.
- **`OPENROUTER_INPUT_DIR` env var.** Sandbox root for `input_images` file paths. Falls back to `OPENROUTER_OUTPUT_DIR`, then `cwd`. Honors `OPENROUTER_ALLOW_UNSAFE_PATHS=1` for the legacy bypass, matching `save_path` semantics.
- **`generate-image.test.ts`.** 18 new unit tests covering `mimeFromExt`, `resolveInputImage` (data/http passthrough, file → base64, traversal rejection, symlink-aware sandbox, env-var fallback), and `buildUserContent` (text vs multimodal branches, preamble, order preservation). Total test count 181.

## [3.1.1] — 2026-05-03

### Added
- **Published to the official [MCP Registry](https://registry.modelcontextprotocol.io)** as `io.github.stabgan/openrouter-multimodal`. The registry replaced the deprecated community list on `modelcontextprotocol/servers` and is now the upstream data source for `wong2/awesome-mcp-servers`, `mcp.so`, and most modern MCP aggregators.
- **`llms.txt`** at the repo root — emerging standard for AI-agent crawlers indexing open-source projects. Condensed summary of install, tools, error taxonomy, and security posture.
- **`server.json`** registry manifest covering the npm package (`@stabgan/openrouter-mcp-multimodal`) and Docker image (`docker.io/stabgan/openrouter-mcp-multimodal`), with environment variable schemas for `OPENROUTER_API_KEY`, `OPENROUTER_DEFAULT_MODEL`, and `OPENROUTER_OUTPUT_DIR`.
- **Dockerfile labels** — `io.modelcontextprotocol.server.name` (required by the MCP Registry to verify OCI-package namespace ownership) plus the standard OCI `org.opencontainers.image.*` annotations so `docker inspect` and Docker Hub's listing surface pick up the metadata.

### Changed
- **README first paragraph** now names the six MCP-compatible clients (Claude Desktop, Cursor, Kiro, VS Code, Windsurf, Cline) and the six LLM families reached through OpenRouter (Claude, Gemini, GPT, Llama, Qwen, Grok) — high-intent search phrases that were previously buried in the doc.
- **Repo topics** rebalanced to 20 high-traffic discovery tags: added `claude-desktop`, `cursor`, `gemini`, `ai-agent`, `tts`, `stt`, `vision`; dropped the low-traffic specific ones (`seedance`, `video-understanding`, `audio-transcription`, `audio-generation`, `nodejs`, `ai`, `image-analysis`). Kept irreplaceable specifics: `veo`, `sora`, `model-context-protocol`, `openrouter`, `multimodal`.
- **GitHub repo description** leads with use case + named clients.
- **Wiki disabled** — was empty and diluted search indexing.

## [3.1.0] — 2026-05-03

### Added
- **`generate_image` now accepts `aspect_ratio` and `image_size`** ([#8](https://github.com/stabgan/openrouter-mcp-multimodal/issues/8)). `aspect_ratio` supports all 14 OpenRouter-documented values (`1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`, plus the extended `1:4`, `4:1`, `1:8`, `8:1` honored by `google/gemini-3.1-flash-image-preview`). `image_size` supports `0.5K` / `1K` / `2K` / `4K`. Invalid values are rejected client-side with `INVALID_INPUT` before the request is sent — the local enum was verified against OpenRouter's own server-side schema by probing `POST /chat/completions` with an invalid ratio and cross-checking the returned `values` array. End-to-end verified: four images at 16:9, 9:16, 1:1, and 4:3 were generated through the full handler path and the PNG `IHDR` chunks confirmed aspect ratios within ~3% of the request (tiny delta is model-side rounding to OpenRouter's published resolution buckets).
- **`generate_image` now accepts `max_tokens`.** Without this cap OpenRouter reserves the full model context window (~29k tokens for Gemini image models) up front, which 402s free-tier / low-credit accounts even when the actual image completion would cost pennies. `4096` works well in practice.
- **`generate_image` now sends `modalities: ["image", "text"]`** per the current OpenRouter image-generation API. Some multimodal models (including the default `google/gemini-2.5-flash-image`) were already emitting images without this hint, but others reply with text-only refusals unless the modalities are declared explicitly. This removes a latent class of "model returned no image" false negatives.

### Fixed
- **[#13] `fetchHttpResource` now sends a `User-Agent` and `Accept` header.** Node's default `fetch()` ships no UA, and UA-screening CDNs (notably Wikimedia / Varnish) return HTTP 403/400 for such requests. That failure was bubbling to MCP callers through `analyze_image` / `analyze_audio` / `analyze_video` as a bare "HTTP 400" that looked like an OpenRouter / model failure. The UA is now `openrouter-mcp-multimodal/<version> (+<repo-url>)` with the version read from `package.json` at module load so future bumps stay in sync. Originally shipped by [@ZoneoutReal](https://github.com/ZoneoutReal) in [#14](https://github.com/stabgan/openrouter-mcp-multimodal/pull/14); refactored to read the version dynamically in [2843da4](https://github.com/stabgan/openrouter-mcp-multimodal/commit/2843da4).
- **HTTP response body leak in `openrouter-api.ts::fetchWithRetry`.** On 429 / 5xx retries the previous response body was never consumed or cancelled before the backoff sleep, so undici held the pooled connection open until GC reclaimed the `ReadableStream`. Now calls `res.body?.cancel()` before retrying.
- **`generate_image` silently dropped images with MIME parameters in their data URLs.** The old regex `^data:([^;]+);base64,(.+)$` only matched data URLs with zero MIME parameters. Models that emit `data:image/png;charset=binary;base64,...` (some Gemini builds do) were falling through and the tool reported "no image in response" even though the model delivered one. Fixed by delegating to the already-correct `parseBase64DataUrl` from `fetch-utils.ts`.
- **Error shape inconsistency across `search_models` / `get_model_info` / `validate_model`.** These three handlers returned legacy `{ content, isError: true }` without the structured `_meta.code` that every other handler emits. Clients relying on `_meta.code` to branch on error types couldn't tell a `MODEL_NOT_FOUND` from an upstream HTTP failure. Now routed through `toolError` / `classifyUpstreamError`, with missing/invalid `model` input rejected up front.

### Declined
- **[#12]** Encrypted credential storage was declined. MCP servers run locally per-user, so plaintext env var / `.env` is the standard threat model. `.env` is gitignored; OS-level file permissions protect it. An encryption layer would shift complexity onto every user without materially reducing risk for the single-developer local usage that drives this project. Reopen if this ever moves to shared / team environments.

## [3.0.0] — 2026-04-20

### Added
- **`generate_video` tool** — submits a text-to-video job to `POST /api/v1/videos`, polls `GET /api/v1/videos/{id}` until `completed` or `failed`, then downloads the mp4 via `GET /api/v1/videos/{id}/content`. Supports `resolution`, `aspect_ratio`, `duration`, `seed`, `first_frame_image`, `last_frame_image`, `reference_images`, and per-provider `provider` passthrough. Emits MCP `notifications/progress` on every poll. Default model `google/veo-3.1`; override via `OPENROUTER_DEFAULT_VIDEO_GEN_MODEL`.
- **`get_video_status` tool** — resume a previously-submitted video job by id. Handles pending/processing/completed/failed uniformly.
- **`analyze_video` tool** — analyze or transcribe video (mp4, mpeg, mov, webm) from a local file, HTTP(S) URL, or base64 data URL. Uses OpenRouter's `video_url` content type. Default model `google/gemini-2.5-flash`.
- **`video-utils.ts`** — magic-byte detection for mp4/mov (ftyp), webm (EBML), MPEG-PS start codes; SSRF-protected HTTP fetch with 100 MB default cap; data-URL and local-file paths.
- **`openrouter-errors.ts`** — shared classifier that maps OpenAI SDK errors, raw fetch errors, and OpenRouter REST 4xx/5xx responses to the closed `ErrorCode` enum. Extracts HTTP status from `err.status`, `err.code`, or `HTTP NNN` in the message. Distinguishes credits / ZDR / rate limits / model-not-found / content policy.
- **`completion-utils.ts`** — shared helpers that render OpenRouter responses to text. Handles multimodal array content and reasoning-only responses (`content: null` + `reasoning`/`reasoning_details`). Detects `finish_reason === 'length'` on reasoning-only output and returns a structured `INVALID_INPUT` with actionable guidance instead of an empty string. Applied to every tool that calls `chat.completions.create` (chat, analyze_image, analyze_audio, analyze_video).
- **`src/errors.ts`** — closed `ErrorCode` enum (`INVALID_INPUT`, `UNSAFE_PATH`, `UPSTREAM_HTTP`, `UPSTREAM_TIMEOUT`, `UPSTREAM_REFUSED`, `UNSUPPORTED_FORMAT`, `RESOURCE_TOO_LARGE`, `ZDR_INCOMPATIBLE`, `MODEL_NOT_FOUND`, `JOB_FAILED`, `JOB_STILL_RUNNING`, `INTERNAL`). Every handler returns `{ isError: true, _meta: { code, details? } }` so clients can switch on failure modes without regex-parsing free text.
- **`src/logger.ts`** — one JSON line per event on stderr; level filtered by `OPENROUTER_LOG_LEVEL`. Replaces ad-hoc `console.error` output.
- **MCP 2025 tool annotations** — every tool advertises `readOnlyHint`, `destructiveHint`, `idempotentHint`.
- **Fail-fast path sandbox** — `save_path` is validated by `resolveSafeOutputPath` BEFORE spending tokens. Unsafe paths return `UNSAFE_PATH` in milliseconds instead of after the model responds.
- **`search_models` capability filters** — `capabilities.audio` and `capabilities.video` in addition to `vision`.
- **Retry-After-aware video client** — `submitVideoJob`, `pollVideoJob`, `downloadVideoContent` on `OpenRouterAPIClient` all use the jitter/Retry-After-aware `fetchWithRetry` with proper `HTTP-Referer` / `X-Title` attribution headers.
- **Multi-arch Docker image** — CI now builds linux/amd64 + linux/arm64 via buildx + QEMU so Apple Silicon users pull a native image.
- **Live E2E test harness** — `scripts/live-e2e.mjs` drives every tool over stdio against the real OpenRouter API. 16/16 green in the release run. Additional smokes: `scripts/smoke-npm-mcp.mjs` (tarball install + stdio), `scripts/smoke-docker-mcp.mjs` (container + stdio), `scripts/mock-e2e-video.mjs` (full video-gen pipeline with mocked API client).

### Fixed (live-traffic bugs uncovered during E2E smoke)
- **Reasoning-model empty response (P1)** — `chat_completion`, `analyze_image`, `analyze_audio`, `analyze_video` now detect when a model (e.g. NVIDIA Nemotron VL) runs `max_tokens` out during chain-of-thought and emits `content: null`. Instead of returning an empty string, the tools return `INVALID_INPUT` with a reasoning preview and guidance to raise `max_tokens` or pick a non-reasoning model.
- **Image-gen silent text-only fallback (P2)** — `generate_image` now returns `UPSTREAM_REFUSED` (`reason: no_image_in_response`) when the model emits chat text without an image payload, instead of passing the chatter through as "success".
- **Error taxonomy gaps** — `generate_audio`, `generate_image`, `analyze_image`, `analyze_audio`, `chat_completion` were all still using raw string errors without `_meta.code`. All migrated through `toolError` / `classifyUpstreamError`.
- **Generate-video upstream error mapping** — OpenRouter's `POST /videos` responds with `HTTP 400 — Model X does not exist` for unknown models. The classifier now extracts the 400 status from the message and maps "does not exist" to `MODEL_NOT_FOUND` (not the overly-broad `INVALID_INPUT`).
- **Fail-fast save_path** — the path sandbox used to run AFTER the OpenRouter call finished, so a rejected write still burned credits. Now validates before submission (sub-millisecond).

### Fixed (security + correctness)
- **BUG-001 — IPv6 SSRF blocklist bypass (P0).** `isBlockedIPv6` missed IPv4-mapped (`::ffff:127.0.0.1`), IPv4-compatible (`::127.0.0.1`), unspecified (`::`), multicast (`ff00::/8`), 6to4 of private IPv4 (`2002::/16`), documentation (`2001:db8::/32`), Teredo (`2001::/32`), ORCHID, and compressed `::1`. Rewrote with a comprehensive IPv6 expander using `node:net`; 22 new test cases cover every class.
- **BUG-003 — `AbortSignal.timeout` reused across retries (P1).** A shared signal meant retries immediately aborted once the first attempt's deadline elapsed. Each attempt now gets a fresh signal with a full budget.
- **BUG-004 — No `Retry-After` + no jitter (P1).** `fetchWithRetry` now honors `Retry-After` (integer seconds or HTTP-date) and applies a 0.5×–1.5× jitter with a 10-second ceiling to avoid thundering-herd retries.
- **BUG-005 — Hardcoded 24 kHz WAV header (P1).** `createWavHeader` and `wrapPcmInWav` now accept a `sampleRate` argument; default remains 24000 for `openai/gpt-audio` compatibility.
- **BUG-006 — Path traversal on `save_path` (P1).** New `src/tool-handlers/path-safety.ts` sandboxes generate-\* writes against `OPENROUTER_OUTPUT_DIR` (default `process.cwd()`). Absolute paths, `..` escapes, and symlink traversal are rejected.
- **BUG-007 — MP3 magic-byte false positives (P1).** Tightened `detectAudioFormat`'s raw-frame-sync check: version, layer, bitrate index, and sample-rate index must all be non-reserved.
- **BUG-008 — `ModelCache` concurrent populate race (P2).** New `ensureFresh(fetcher)` coalesces concurrent callers onto a single in-flight `/models` request.
- **BUG-009 — Data-URL regex rejected MIME parameters (P2).** New `parseBase64DataUrl` handles `data:audio/wav;charset=binary;base64,...` and similar RFC 2397 variants.
- **BUG-010 — Vitest ran every test twice (P2).** `vitest.config.ts` now includes only `src/__tests__/**/*.test.ts`.
- **BUG-011 — No Content-Length short-circuit (P2).** `readResponseBodyWithLimit` rejects oversize responses before streaming and cancels the body on cap breach.
- **BUG-012 — `prepareImageUrl` mislabeled HTTP images (P2).** `optimizeImage` now returns `{ base64, mime }` with magic-byte MIME sniffing fallback when sharp is unavailable.
- **BUG-015 — Search-models `limit` not clamped (P3).** Now clamped to `[1, 50]` server-side even when callers bypass the JSON schema.
- **BUG-016 — `prepare` script forced rebuild on install (P3).** Renamed to `prepublishOnly`. Dockerfile no longer patches `package.json`.
- **BUG-020 — Tests shipped in `dist/` (P3).** `tsconfig.json` excludes `src/__tests__/**` from emit.

### Changed
- **Install links** — rebuilt all one-click install buttons against the current Kiro / Cursor / VS Code / VS Code Insiders deeplink specs. v2 buttons were broken because they wrapped the server config in `{mcpServers:{...}}` which none of the three IDEs accept. Decoded payloads in an HTML comment for audit.
- **Dev workflow** — `.kiro/` (specs + agents + steering) is now gitignored so workspace artifacts don't leak into the published repo. `.mcp-smoke-output/` is gitignored too.
- **Architecture section** — reflects the new `openrouter-errors.ts`, `completion-utils.ts`, `path-safety.ts`, video client methods on `OpenRouterAPIClient`, tightened IPv6 SSRF coverage, and retry-aware backoff.

### Deferred to a future release
- DNS-rebinding TOCTOU pinning via undici.
- Zod-based runtime arg validation at the dispatch layer.
- Streaming completions for `chat_completion` / `analyze_*`.
- MCP resource attachments for generated media (let LLMs re-fetch outputs as MCP resources).
- Per-model pricing × usage = `_meta.cost_usd` estimation.

## [2.1.0] — Not released

> Internal checkpoint. The fixes listed under Unreleased represent the v2.1 security + correctness audit that lands together with v3 work. If you need a v2.x-only build (without video tools), pin `2.1.0-pre` by building from this commit.

## [2.0.0] — 2026-03

Initial public release with chat, image analysis + generation, audio analysis + generation, model search / info / validate. Native `fetch`, sharp-backed image optimization, streaming audio, SSRF guards for IPv4, Docker + npm + Smithery distribution.
