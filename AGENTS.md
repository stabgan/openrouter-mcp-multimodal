# Agent instructions

Guidance for AI coding agents (Cursor, Claude Code, Copilot, etc.) working in **openrouter-mcp-multimodal**.

## Before you ship

1. Run **`npm run ci`** before claiming work is done (lint, format, version sync, build, tests).
2. Do **not** commit secrets (`.env`, API keys).
3. Keep imports at the top of files — no inline imports unless documented for circular deps.
4. Use exhaustive `switch` with `never` in the default case for TypeScript unions.

## Releasing (read this before publishing)

**Full guide:** [`docs/RELEASING.md`](docs/RELEASING.md)

### Short version

| Action | Updates npm/PyPI? | Updates Docker `:latest`? |
| :----- | :---------------- | :------------------------ |
| Push to `main` | No | No |
| Merge Release Please PR → tag `vX.Y.Z` | **Yes** | **Yes** |
| Manual `git tag vX.Y.Z && git push origin vX.Y.Z` | **Yes** | **Yes** |

**Normal path:** land conventional commits on `main` → merge the Release Please PR → tag is created automatically → [`publish.yml`](.github/workflows/publish.yml) publishes everywhere.

**Manual path:** bump all version files (see list below) → `npm run version:check` → test → commit → `git tag vX.Y.Z` → push tag.

### Version files (must all match `package.json`)

- `package.json` / `package-lock.json`
- `src/version.ts` (`SERVER_VERSION`)
- `python/pyproject.toml`
- `server.json` (version fields + Docker OCI tag)
- `.release-please-manifest.json`
- `CHANGELOG.md` (release notes)
- `README.md` pin examples (recommended)

Check: **`npm run version:check`**

### Pre-release tests

```bash
npm run ci
npm run test:smoke:npm
npm run test:smoke:uvx:local
# Docker: docker build -t openrouter-mcp-multimodal:$(node -p "require('./package.json').version")-test .
#         node scripts/smoke-docker-mcp.mjs
```

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
| Tool JSON schemas | `src/tool-definitions.ts` |
| Handler implementations | `src/tool-handlers/` |
| Tests | `src/__tests__/` |
| Python uvx launcher | `python/mcp_server_openrouter_multimodal/` |
| MCP registry manifest | `server.json` |
| Security policy | `SECURITY.md` |
| Smoke tests | `scripts/smoke-*.mjs` |
| CI | `.github/workflows/ci.yml` |
| Publish | `.github/workflows/publish.yml` |
| Release automation | `.github/workflows/release-please.yml`, `release-please-config.json` |

## Do not

- Push to `main` and assume npm/PyPI updated — they only publish on **version tags**.
- Bump version in only one file — CI will fail `version:check`.
- Create git commits or tags unless the user asked you to release.
