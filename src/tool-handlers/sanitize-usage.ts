/**
 * Allowlist-sanitize upstream `usage` objects before forwarding to MCP clients.
 *
 * Every OpenRouter API response includes a `usage` object with token/cost
 * accounting.  The TypeScript types declare `[key: string]: unknown` index
 * signatures, so the runtime object is effectively untrusted — a malformed
 * upstream response could embed:
 *
 *   - Prototype-pollution keys (`__proto__`, `constructor`, `prototype`)
 *   - Non-numeric values for token counts (strings, objects, NaN)
 *   - Arbitrary extra properties that inflate the MCP response
 *
 * This module provides a single `sanitizeUpstreamUsage` function that
 * allowlists the known numeric fields and drops everything else.  It is
 * used by every handler that surfaces `usage` in `_meta` or
 * `structuredContent` — keeping the logic in one place prevents the
 * inconsistency where `embed_text` sanitized but `decide`, `rerank`,
 * `speech_to_text`, and `generate_image_dedicated` did not.
 */

/** Keys that could cause prototype pollution when iterated with Object.entries/for-in. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Known numeric fields across all OpenRouter usage responses.
 *
 * - `prompt_tokens` / `completion_tokens` / `total_tokens` — standard
 *   OpenAI-compatible token accounting (embeddings, chat, transcription).
 * - `cost` — OpenRouter-specific cost in USD.
 */
const KNOWN_NUMERIC_KEYS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const;

/**
 * Sanitize an upstream `usage` object by allowlisting known numeric fields.
 *
 * Returns a clean `Record<string, number>` with only finite numeric values,
 * or `undefined` if the input is missing/empty/invalid.
 */
export function sanitizeUpstreamUsage(
  usage: Record<string, unknown> | undefined | null,
): Record<string, number> | undefined {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return undefined;

  // Early rejection for prototype-pollution keys at the top level.
  for (const key of Object.keys(usage)) {
    if (UNSAFE_KEYS.has(key)) return undefined;
  }

  const safe: Record<string, number> = {};
  for (const key of KNOWN_NUMERIC_KEYS) {
    const val = (usage as Record<string, unknown>)[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      safe[key] = val;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}
