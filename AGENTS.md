# Agent instructions

Guidance for AI coding agents (Cursor, Claude Code, Copilot, Kiro, etc.) working in **openrouter-mcp-multimodal**.

## Before you ship

1. Run **`npm run ci`** before claiming work is done — this runs lint, format check, version sync, build, and all tests.
2. Do **not** commit secrets (`.env`, API keys).
3. Keep imports at the top of files — no inline imports unless documented for circular deps.
4. Use exhaustive `switch` with `never` in the default case for TypeScript unions.

## Architecture at a glance

```
src/index.ts                    ← MCP server entry, stdio transport, .env loading
src/tool-handlers.ts            ← Tool router: ListTools + CallTool dispatch
src/tool-definitions.ts         ← Tool JSON schemas (inputSchema, outputSchema, annotations, icons)
src/tool-descriptions.ts        ← TOOL_NAMES array + structured descriptions (use when / bad examples / fails when)
src/tool-icons.ts               ← SVG data URI icons for each tool (MCP 2025-11-25)
src/tool-handlers/              ← One handler file per tool (handleChatCompletion, handleGenerateVideo, etc.)
src/openrouter-api.ts           ← Direct HTTP client for /videos, /images, /audio/speech, /audio/transcriptions, /rerank
src/openrouter-openai-client.ts ← OpenAI SDK configured for OpenRouter base URL
src/errors.ts                   ← ErrorCode taxonomy (INVALID_INPUT, UNSAFE_PATH, UPSTREAM_*, etc.)
```

### Tools (19 total)

| Category | Tools |
| :------- | :---- |
| **Chat** | `chat_completion`, `start_chat_completion`, `get_chat_completion_status` |
| **Vision** | `analyze_image`, `generate_image`, `generate_image_dedicated` |
| **Audio** | `analyze_audio`, `generate_audio`, `text_to_speech`, `speech_to_text` |
| **Video** | `analyze_video`, `generate_video`, `generate_video_from_image`, `get_video_status` |
| **Catalog** | `search_models`, `get_model_info`, `validate_model`, `rerank_documents`, `health_check` |

### Key patterns

- **Tool definitions live in `tool-definitions.ts`**, descriptions in `tool-descriptions.ts`, icons in `tool-icons.ts`. All three must stay in sync with `TOOL_NAMES`. The build-time assertion in `tool-definitions.ts` catches count mismatches.
- **Handlers** return `{ content, _meta }` for success or `toolError(ErrorCode, message)` for errors. Every error carries `_meta.code`.
- **Path safety**: all local file reads go through `resolveSafeInputPath`, all writes through `resolveSafeOutputPath`. Never bypass the sandbox.
- **OpenRouter API**: chat/analyze tools use the OpenAI SDK via `openrouter-openai-client.ts`. Video/image/audio dedicated endpoints and rerank use the direct HTTP client in `openrouter-api.ts`.
- **Async tools**: `start_chat_completion` fires a background request and returns a `job_id` immediately. `get_chat_completion_status` polls. Video generation follows the same pattern via `generate_video` + `get_video_status`.
- **Caching**: `cache`, `cache_ttl`, `cache_clear` params on tools map to `X-OpenRouter-Cache*` headers via `cache.ts`.
- **Provider routing**: `provider` param on tools passes through to OpenRouter's routing system. Env defaults in `provider-routing.ts`.

## Coding style

- **TypeScript strict mode**, ESM (`"type": "module"`)
- **Prettier**: single quotes, trailing commas, 100 char width, semicolons
- **ESLint**: `@typescript-eslint/recommended` + prettier config
- **Naming**: `handleFooBar` for tool handlers, `ErrorCode.SCREAMING_SNAKE` for error codes
- **No default exports** — named exports everywhere
- **Tests**: Vitest. File per module at `src/__tests__/`. No test unless user asks.

## Testing

| Command | What it runs | When to use |
| :------ | :----------- | :---------- |
| `npm test` | Unit tests (Vitest) | After any code change |
| `npm run test:regression` | Regression suite | Before release |
| `npm run test:integration` | Integration tests (may hit OpenRouter) | Before release, needs API key |
| `npm run test:e2e` | Live E2E against real OpenRouter | Release validation |
| `npm run test:smoke:npm` | Build → pack → install → boot | Verify npm package works |
| `npm run test:smoke:docker` | Docker image boot test | Verify Docker image |
| `npm run test:smoke:uvx:local` | uvx/pipx launcher test | Verify Python launcher |
| `npm run test:all` | unit + regression + integration | Pre-release gate |
| `npm run ci` | lint + format + version sync + build + test:all | **The one command before shipping** |

Current: **52 test files, 1021 tests**.

## Releasing (read this before publishing)

**Full guide:** [`docs/RELEASING.md`](docs/RELEASING.md)

### Short version

| Action | Updates npm/PyPI? | Updates Docker `:latest`? |
| :----- | :---------------- | :------------------------ |
| Push to `main` | No | No |
| Merge Release Please PR → tag `vX.Y.Z` | **Yes** | **Yes** |
| Manual `git tag vX.Y.Z && git push origin vX.Y.Z` | **Yes** | **Yes** |

**Normal path:** land conventional commits on `main` → merge the Release Please PR → tag is created automatically → [`publish.yml`](.github/workflows/publish.yml) publishes everywhere.

**Manual path:** bump all version files → `npm run version:check` → test → commit → `git tag vX.Y.Z` → push tag.

### Version files (must all match `package.json`)

- `package.json` / `package-lock.json`
- `src/version.ts` (`SERVER_VERSION`)
- `python/pyproject.toml`
- `server.json` (version fields + Docker OCI tag)
- `.release-please-manifest.json`
- `CHANGELOG.md` (release notes)

Check: **`npm run version:check`**

### Commit messages for Release Please

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `fix: …` — patch release
- `feat: …` — minor release
- `feat!: …` or footer `BREAKING CHANGE:` — major release

## Repo map

| Area | Location |
| :--- | :------- |
| MCP entry + handshake | `src/index.ts`, `src/version.ts` |
| Tool router | `src/tool-handlers.ts` |
| Tool JSON schemas + icons | `src/tool-definitions.ts`, `src/tool-icons.ts` |
| Tool descriptions | `src/tool-descriptions.ts` |
| Handler implementations | `src/tool-handlers/*.ts` |
| OpenRouter HTTP client | `src/openrouter-api.ts` |
| OpenAI SDK client | `src/openrouter-openai-client.ts` |
| Error taxonomy | `src/errors.ts` |
| Path sandbox | `src/tool-handlers/path-safety.ts`, `src/tool-handlers/path-utils.ts` |
| Cache headers | `src/tool-handlers/cache.ts` |
| Provider routing | `src/tool-handlers/provider-routing.ts` |
| Tests | `src/__tests__/` |
| Python uvx launcher | `python/mcp_server_openrouter_multimodal/` |
| MCP registry manifest | `server.json` |
| Security policy | `SECURITY.md` |
| Strategy & vision | `STRATEGY.md` |
| Domain glossary | `CONCEPTS.md` |
| Smoke tests | `scripts/smoke-*.mjs` |
| CI | `.github/workflows/ci.yml` |
| Publish | `.github/workflows/publish.yml` |
| Release automation | `.github/workflows/release-please.yml` |

## Adding a new tool

1. Create `src/tool-handlers/my-tool.ts` with `export async function handleMyTool(...)`.
2. Add the tool name to `TOOL_NAMES` in `src/tool-descriptions.ts` and add its description using `buildToolDescription()`.
3. Add the JSON schema (inputSchema, outputSchema, annotations) in `src/tool-definitions.ts`.
4. Add an icon entry in `src/tool-icons.ts`.
5. Add the dispatch `case` in `src/tool-handlers.ts`.
6. Update the test count assertion in `src/__tests__/tool-descriptions.test.ts` and `src/__tests__/regression/regression.test.ts`.
7. Run `npm run ci`.

## Do not

- Push to `main` and assume npm/PyPI updated — they only publish on **version tags**.
- Bump version in only one file — CI will fail `version:check`.
- Create git commits or tags unless the user asked you to release.
- Bypass path sandbox (`resolveSafeInputPath` / `resolveSafeOutputPath`) for local file access.
- Add inline imports unless there's a documented circular dependency reason.
- Remove or weaken SSRF guards in `fetch-utils.ts`.
