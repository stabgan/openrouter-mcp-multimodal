---
name: OpenRouter MCP Multimodal
last_updated: 2026-07-02
---

# OpenRouter MCP Multimodal Strategy

## Target problem

Developers using MCP clients (Cursor, Claude Desktop, VS Code, etc.) need multimodal AI — chat, vision, audio, video, and generation — without wiring a separate SDK, auth layer, and security sandbox for every modality. OpenRouter exposes 300+ models behind one API, but MCP agents still lack a single, hardened server that maps those capabilities to well-typed tools with predictable errors and safe file handling.

## Our approach

Ship the **only lean, security-first MCP bridge** that covers the full OpenRouter multimodal surface in one package: strict path sandboxes and SSRF guards before any paid call, MCP 2025 structured outputs on catalog tools, and parity with OpenRouter platform features (caching, routing, rerank, async video) as they land — so agents get reliable tools instead of a growing pile of one-off integrations.

## Who it's for

**Primary:** Individual developers and small teams building AI agents in MCP-native IDEs — they're hiring this server to give their agent OpenRouter's full model catalog plus multimodal tools without writing HTTP glue or worrying about path traversal on `save_path`.

## Key metrics

- **Weekly npm downloads + Docker pulls** — distribution reach; measured on npmjs.com and Docker Hub
- **Live E2E pass rate** (`scripts/live-e2e.mjs`) — end-to-end tool health against real OpenRouter; run on release
- **Unit test count + CI green** — regression safety; GitHub Actions on every publish
- **OpenRouter parity gap count** — documented missing platform features (structured JSON on chat, `/images` REST, embeddings); reviewed each release against OpenRouter docs
- **Security audit findings (HIGH+)** — target zero open HIGH/CRITICAL between releases; tracked in CHANGELOG audit sections

## Tracks

### OpenRouter platform parity

Keep tool schemas and handlers aligned with OpenRouter docs as features ship: dedicated image API, structured outputs on `chat_completion`, web-search plugin evolution, video model catalog changes.

_Why it serves the approach:_ Agents only trust us if calling a tool maps 1:1 to what OpenRouter actually supports today.

### MCP spec & agent ergonomics

Structured outputs, progress notifications, tool annotations, failure-mode docs ("Fails when" / "Works with"), pagination on large catalogs.

_Why it serves the approach:_ MCP clients in 2026 expect typed responses and honest error metadata — this is how we beat raw HTTP wrappers.

### Security & reliability

Path sandbox (`resolveSafeInputPath` / `resolveSafeOutputPath`), SSRF blocklist, fail-fast before token spend, audit logging on paid ops, monotonic progress, defensive fatal logging.

_Why it serves the approach:_ Untrusted MCP callers are the threat model; one exfiltration bug kills the product.

### Distribution & smoke coverage

npm, Docker, Smithery/MCPB bundles; live E2E + integration tests; lean codebase (no dead scripts, merged test modules).

_Why it serves the approach:_ Most users install via `npx`; release confidence comes from real API smokes, not unit tests alone.

## Not working on

- Hosted web UI or chat frontend — we are a stdio MCP server, not a product surface
- Streaming `chat_completion` — deferred; adds client complexity with limited MCP benefit today
- Embeddings API — out of scope until a clear agent workflow demands it
- Building our own model router — OpenRouter already routes; we expose their knobs

## Marketing

**One-liner:** One MCP server — text, image, audio, and video analysis and generation across 300+ OpenRouter models, with security sandboxes built in.

**Key message:** Install with `npx`, paste your OpenRouter key, and your agent gets 14 hardened tools. No other MCP package covers generation and analysis for every modality in a single dependency.
