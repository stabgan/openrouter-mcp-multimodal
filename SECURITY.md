# Security Policy

## Supported versions

| Version | Supported |
| :------ | :-------- |
| 4.7.x   | ✅        |
| 4.6.x   | ✅        |
| 4.5.x   | ✅        |
| below 4.5.2 | ❌ — upgrade for analyze\_\* path sandbox ([GHSA-3q7p-736f-x44v](https://github.com/stabgan/openrouter-mcp-multimodal/security/advisories/GHSA-3q7p-736f-x44v)) |

Security fixes land on the latest minor release. Prefer **`@stabgan/openrouter-mcp-multimodal@latest`** or pin **`4.7.0`**.

## Reporting a vulnerability

**Do not open public GitHub issues for exploitable security bugs.**

1. Email the maintainer via [GitHub private vulnerability reporting](https://github.com/stabgan/openrouter-mcp-multimodal/security/advisories/new) (preferred), or contact the repo owner listed on [npm](https://www.npmjs.com/package/@stabgan/openrouter-mcp-multimodal).
2. Include reproduction steps, affected version, and impact.
3. Expect an initial response within **72 hours**. We will coordinate disclosure and credit where appropriate.

## Security controls

| Control | Scope |
| :------ | :---- |
| **Input path sandbox** | Local paths on `analyze_*`, reference images, and async job reads must resolve inside `OPENROUTER_INPUT_DIR` (fallback: `OPENROUTER_OUTPUT_DIR`, then `cwd`). Violations return `_meta.code: UNSAFE_PATH`. |
| **Output path sandbox** | `save_path` on generate tools must stay inside `OPENROUTER_OUTPUT_DIR`. Symlink escapes blocked via `realpath`. |
| **Legacy bypass** | `OPENROUTER_ALLOW_UNSAFE_PATHS=1` disables both sandboxes (discouraged). |
| **SSRF protection** | HTTP(S) fetches block private/reserved IPv4 and IPv6 ranges. |
| **Async job isolation** | `get_chat_completion_status` validates `job_id` format and resolves disk paths under `OPENROUTER_OUTPUT_DIR/openrouter-jobs/` only (fixed in **4.7.0**). |

Configure sandboxes in [`.env.example`](./.env.example):

```bash
OPENROUTER_INPUT_DIR=./inputs    # readable local files
OPENROUTER_OUTPUT_DIR=./output   # save_path writes + optional job persistence
```

## Advisories

| ID | Severity | Fixed in | Summary |
| :-- | :------- | :------- | :------ |
| [GHSA-3q7p-736f-x44v](https://github.com/stabgan/openrouter-mcp-multimodal/security/advisories/GHSA-3q7p-736f-x44v) | Medium | **4.5.2** | `analyze_image` / `analyze_audio` / `analyze_video` read arbitrary local files without sandbox. |
| Async `job_id` path traversal | — | **4.7.0** | Malicious `job_id` could escape `openrouter-jobs/` before disk read; blocked by `isValidJobId` + `resolveSafeJobStatusPath`. No public GHSA filed. |

Post-mortem for the analyze-path issue: [`docs/solutions/security-issues/analyze-path-traversal-ghsa-3q7p-736f-x44v.md`](docs/solutions/security-issues/analyze-path-traversal-ghsa-3q7p-736f-x44v.md).
