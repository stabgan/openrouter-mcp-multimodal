---
title: "Arbitrary local-file read in analyze_* tools (GHSA-3q7p-736f-x44v)"
module: tool-handlers
date: 2026-07-02
problem_type: security_issue
component: typescript_module
symptoms:
  - "analyze_image / analyze_audio / analyze_video read any local path via fs.readFile"
  - "MCP caller could exfiltrate ~/.ssh, .env, /etc/passwd into outbound OpenRouter requests"
root_cause: path_traversal
resolution_type: code_fix
tags:
  - "path-sandbox"
  - "GHSA-3q7p-736f-x44v"
  - "analyze_image"
  - "CWE-22"
severity: medium
ghsa: GHSA-3q7p-736f-x44v
---

# Arbitrary local-file read in analyze_* tools

## Problem

`analyze_image`, `analyze_audio`, and `analyze_video` accepted local file paths and passed them directly to `fs.readFile` without calling the existing `resolveSafeInputPath` sandbox. An MCP client (or prompt-injected agent) could read arbitrary files the server uid can access; bytes were base64-encoded into outbound model requests.

Reported in [GHSA-3q7p-736f-x44v](https://github.com/stabgan/openrouter-mcp-multimodal/security/advisories/GHSA-3q7p-736f-x44v) (CVSS 6.3, draft). `generate_image` / `generate_video` already used the sandbox — only the analyze read path was unprotected.

## Symptoms

- `image_path: "/etc/passwd"` or `../escape.png` succeeded and file bytes appeared in the chat-completions payload
- Errors mapped to `INVALID_INPUT` instead of `UNSAFE_PATH`
- PoC: loopback capture of outbound POST body showed verbatim file contents

## What didn't work

- Relying on tool schema descriptions alone — no server-side enforcement
- Duplicating sandbox logic in each handler — `resolveSafeInputPath` already existed in `path-safety.ts`

## Solution

Route every local-file branch through `resolveSafeInputPath` **before** `fs.readFile`:

- `src/tool-handlers/image-utils.ts` — `fetchImage`
- `src/tool-handlers/audio-utils.ts` — `prepareAudioData` (sandbox before format check so `/etc/passwd` fails as traversal, not unsupported format)
- `src/tool-handlers/video-utils.ts` — `prepareVideoData`

Map `UnsafeOutputPathError` to `ErrorCode.UNSAFE_PATH` in `analyze-image.ts`, `analyze-audio.ts`, `analyze-video.ts`.

Update MCP `inputSchema` descriptions for `image_path` / `audio_path` / `video_path` to document sandbox semantics.

## Why this works

`resolveSafeInputPath` realpath-checks paths against `OPENROUTER_INPUT_DIR` → `OPENROUTER_OUTPUT_DIR` → `cwd`, rejecting absolute paths and `..` traversal outside the root — the same guard already used by `generate_image` input refs and `generate_video` frame images.

## Prevention

- Regression tests: `src/__tests__/analyze-media-sandbox.test.ts` (handlers reject `/etc/passwd` before OpenRouter call)
- Unit tests: `fetchImage` / `prepareAudioData` / `prepareVideoData` reject outside-sandbox paths
- When adding new tools that read local files, use `resolveSafeInputPath` in the shared fetch helper, not in the handler alone
- Keep analyze and generate paths symmetric — any new read sink gets the same sandbox as write/generate-input paths
