# Tool Description Improvement Plan

**Last updated:** 2026-07-02  
**Scope:** All 14 MCP tools in `openrouter-mcp-multimodal`  
**Goal:** Help both weak and strong LLM agents pick the right tool, pass valid arguments, and recover from errors.

---

## Problem

Current descriptions follow arxiv 2602.18764 (`Fails when` / `Works with`) but lack:

1. **Routing signals** — when to choose this tool vs a sibling (e.g. `analyze_image` vs `chat_completion` with vision)
2. **Concrete argument shapes** — JSON snippets agents can copy
3. **Anti-patterns** — explicit bad examples reduce hallucinated parameters
4. **Async semantics** — video tools return success with `JOB_STILL_RUNNING`; weak models treat that as failure
5. **Sandbox rules** — path/URL constraints buried in error codes, not upfront

Weak models need short, patterned sections. Strong models need edge-case notes (pagination, provider routing, resume flows).

---

## Description Template (per tool)

Every tool description uses this **fixed section order** so agents can scan predictably:

```
{one-line capability summary}

Use when:
- {bullet — positive routing signal}

Do NOT use when:
- {bullet — redirect to correct tool}

Good examples:
- {minimal valid JSON or arg shape}

Bad examples:
- {common mistake → expected error or fix}

Fails when:
- {ErrorCode}: {condition}

Works with: {comma-separated tool names}
```

### Design rules

| Rule | Rationale |
|------|-----------|
| **Lead with verb + object** | "Analyze an image…" not "This tool is for…" |
| **Good example = copy-pasteable** | One line JSON; no placeholders like `<path>` without defaults |
| **Bad example names the fix** | "→ use search_models instead" |
| **Max 4 bullets per section** | Context window cost; split rare cases to parameter `description` fields |
| **Error codes match `_meta.code`** | Agents correlate description ↔ runtime |
| **Video async called out twice** | In summary and in Good examples (`JOB_STILL_RUNNING` resume) |

---

## Tool-by-tool plan

### 1. `chat_completion`

| Section | Content |
|---------|---------|
| Use when | Text Q&A, multi-turn dialogue, tool-free reasoning, web search (`online: true`) |
| Do NOT use when | Image/audio/video files as input → `analyze_*`; image generation → `generate_image` |
| Good | `{ "messages": [{ "role": "user", "content": "Summarize …" }] }` |
| Bad | `{ "messages": [] }` → INVALID_INPUT; `{ "image_path": "…" }` → wrong tool |
| Params to enrich | `model` suffixes (`:nitro`, `:floor`), `provider` object, `include_reasoning` |

### 2. `analyze_image`

| Section | Content |
|---------|---------|
| Use when | OCR, caption, VQA on a **single** image (local path, https URL, or data URL) |
| Do NOT use when | Generate image → `generate_image`; batch catalog → not supported |
| Good | `{ "image_path": "photo.jpg", "prompt": "List all text" }` |
| Bad | `{ "image_path": "/etc/passwd" }` → UNSAFE_PATH; `{ "url": "…" }` → wrong key name |
| Params | `image_path` required; sandbox note in description |

### 3. `analyze_audio`

Same pattern as image; emphasize transcription vs analysis prompt; formats WAV/MP3/FLAC.

### 4. `analyze_video`

Note large payload / default model; warn against huge files (RESOURCE_TOO_LARGE).

### 5. `search_models`

| Section | Content |
|---------|---------|
| Use when | Discover model ids before calling other tools |
| Do NOT use when | Known model id → `validate_model` or `get_model_info` |
| Good | `{ "query": "gemini", "capabilities": { "vision": true }, "limit": 10, "offset": 0 }` |
| Bad | Expecting full 400+ model dump without pagination |

### 6. `get_model_info` / `validate_model`

`validate_model` = cheap boolean; `get_model_info` = pricing/context/modalities.

### 7. `generate_image`

Reference images via `input_images[]`; aspect_ratio enum; save_path sandbox.

### 8. `generate_audio`

Format auto-detect; save_path optional.

### 9. `generate_video`

Longest description: async poll, `max_wait_ms`, `JOB_STILL_RUNNING`, progressToken, frame/reference images.

### 10. `generate_video_from_image`

Narrow wrapper: only `image` + `prompt`; redirect to `generate_video` for last_frame/reference_images.

### 11. `get_video_status`

Resume after timeout; `_meta.last_status` / `progress`.

### 12. `rerank_documents`

Query + string[] documents; default reranker model.

### 13. `health_check`

Never errors; ops startup probe.

---

## Parameter-level descriptions

Tool-level prose is not enough. Each `inputSchema.properties.*.description` should add:

- **Type + required/optional**
- **One good value** (e.g. `aspect_ratio: "16:9"`)
- **One invalid value** where enums exist

Priority order for schema enrichment:

1. Path fields (`*_path`, `input_images`, `save_path`) — sandbox
2. Enum fields (`aspect_ratio`, `resolution`, `role`)
3. Async fields (`max_wait_ms`, `video_id`)
4. Pagination (`offset`, `limit`)

---

## Implementation phases

| Phase | Deliverable | Status |
|-------|-------------|--------|
| **A** | `src/tool-descriptions.ts` + template builder | In progress |
| **B** | Wire into `tool-handlers.ts`; enrich top 5 param descriptions | In progress |
| **C** | `tool-descriptions.test.ts` — section presence, all 14 tools | In progress |
| **D** | Agent eval (manual): weak model tool-pick accuracy on 20 prompts | Planned |
| **E** | README "Tool guide" table linking to descriptions | Planned |

---

## Success metrics

| Metric | Target |
|--------|--------|
| Tool description regression tests | 100% tools pass structure check |
| Wrong-tool calls (manual eval) | ↓ vs baseline |
| INVALID_INPUT rate on path fields | ↓ after sandbox examples |
| Agent recovery after JOB_STILL_RUNNING | Uses `get_video_status` in follow-up |

---

## References

- arxiv 2602.18764 — Schema-Guided Dialogue / explicit failure modes
- arxiv 2511.03497 — Narrow tools improve hit rate (`generate_video_from_image`)
- MCP spec 2025-06-18 — progress notification semantics
- Internal: `docs/solutions/security-issues/analyze-path-traversal-ghsa-3q7p-736f-x44v.md`
