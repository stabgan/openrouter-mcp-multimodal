/**
 * Helpers for chat completion responses — text extraction, reasoning, finish reasons.
 */
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import { ErrorCode, toolError, type ToolErrorResult } from '../errors.js';
import { sanitizeUpstreamUsage } from './sanitize-usage.js';

/** Default cap for text returned in tool content / _meta (chars). Set OPENROUTER_MAX_RESULT_TEXT_CHARS=0 to disable. */
const DEFAULT_MAX_RESULT_TEXT_CHARS = 512_000;

/** Keys that could cause prototype pollution when iterated with Object.entries/for-in. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Maximum number of content entries in the sanitized logprobs output.
 * A typical response has one entry per generated token; 10 000 covers
 * the largest realistic completions while preventing memory exhaustion
 * from a malformed upstream response with millions of entries that would
 * inflate `JSON.stringify` of the MCP `_meta`.
 */
const MAX_LOGPROBS_CONTENT_ENTRIES = 10_000;

/**
 * Maximum number of `top_logprobs` entries per content token.  Input
 * validation caps the user's `top_logprobs` request parameter at 20, but
 * the upstream response is untrusted — a malformed response could return
 * hundreds of entries per token, causing O(n²) amplification during
 * sanitization and serialization.
 */
const MAX_TOP_LOGPROBS_PER_TOKEN = 20;

/**
 * Maximum length for individual token strings in logprobs.  Tokens are
 * usually 1–20 characters; without a ceiling a malformed upstream could
 * embed multi-megabyte strings that inflate the MCP response.  512 chars
 * is generous for any real tokenizer output.
 */
const MAX_LOGPROBS_TOKEN_LENGTH = 512;

/**
 * Maximum number of byte values in a single `bytes` array.  Real tokens
 * are short sequences of UTF-8 bytes (typically 1–20); without a cap a
 * malformed upstream could return arrays with millions of elements.
 */
const MAX_LOGPROBS_BYTES_LENGTH = 64;

interface SanitizedLogprobEntry {
  token: string;
  logprob: number;
  bytes: number[] | null;
}

interface SanitizedLogprobContentEntry extends SanitizedLogprobEntry {
  top_logprobs: SanitizedLogprobEntry[];
}

interface SanitizedLogprobs {
  content: SanitizedLogprobContentEntry[] | null;
  refusal: SanitizedLogprobContentEntry[] | null;
}

/**
 * Sanitize a single logprob entry (token + logprob + bytes).  Returns
 * `null` when the entry is malformed or contains unsafe data, so callers
 * can filter it out rather than crashing.
 */
function sanitizeLogprobEntry(entry: unknown): SanitizedLogprobEntry | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const e = entry as Record<string, unknown>;

  // Strip prototype-pollution keys
  for (const key of Object.keys(e)) {
    if (UNSAFE_KEYS.has(key)) return null;
  }

  const token = e.token;
  if (typeof token !== 'string') return null;
  const safeToken =
    token.length > MAX_LOGPROBS_TOKEN_LENGTH ? token.slice(0, MAX_LOGPROBS_TOKEN_LENGTH) : token;

  const logprob = e.logprob;
  if (typeof logprob !== 'number' || !Number.isFinite(logprob)) return null;

  let safeBytes: number[] | null = null;
  if (e.bytes !== null && e.bytes !== undefined) {
    if (!Array.isArray(e.bytes)) return null;
    const bounded =
      e.bytes.length > MAX_LOGPROBS_BYTES_LENGTH
        ? e.bytes.slice(0, MAX_LOGPROBS_BYTES_LENGTH)
        : e.bytes;
    safeBytes = [];
    for (const b of bounded) {
      if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 255) continue;
      safeBytes.push(b);
    }
  }

  return { token: safeToken, logprob, bytes: safeBytes };
}

/**
 * Sanitize a content/refusal entry array from the upstream logprobs
 * response.  Each entry is reconstructed with only the expected fields,
 * and nested `top_logprobs` arrays are individually validated.
 */
function sanitizeLogprobContentArray(raw: unknown): SanitizedLogprobContentEntry[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;

  const bounded =
    raw.length > MAX_LOGPROBS_CONTENT_ENTRIES ? raw.slice(0, MAX_LOGPROBS_CONTENT_ENTRIES) : raw;

  const result: SanitizedLogprobContentEntry[] = [];
  for (const item of bounded) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

    // Check for prototype-pollution keys at the content entry level
    const record = item as Record<string, unknown>;
    let hasUnsafe = false;
    for (const key of Object.keys(record)) {
      if (UNSAFE_KEYS.has(key)) {
        hasUnsafe = true;
        break;
      }
    }
    if (hasUnsafe) continue;

    const base = sanitizeLogprobEntry(item);
    if (!base) continue;

    // Sanitize nested top_logprobs
    const topLogprobs: SanitizedLogprobEntry[] = [];
    const rawTop = record.top_logprobs;
    if (Array.isArray(rawTop)) {
      const boundedTop =
        rawTop.length > MAX_TOP_LOGPROBS_PER_TOKEN
          ? rawTop.slice(0, MAX_TOP_LOGPROBS_PER_TOKEN)
          : rawTop;
      for (const topEntry of boundedTop) {
        const sanitized = sanitizeLogprobEntry(topEntry);
        if (sanitized) topLogprobs.push(sanitized);
      }
    }

    result.push({ ...base, top_logprobs: topLogprobs });
  }

  return result.length > 0 ? result : null;
}

/**
 * Sanitize the upstream `logprobs` object before forwarding to MCP `_meta`.
 *
 * The `logprobs` field in ChatCompletion responses is a deeply nested
 * structure (content → top_logprobs → bytes arrays) that was previously
 * forwarded raw — the only unsanitized upstream data in the entire
 * codebase.  A malformed or compromised upstream could inject:
 *
 *   - Prototype-pollution keys (`__proto__`, `constructor`, `prototype`)
 *     at any nesting level, exploitable by MCP clients that process
 *     `_meta` with unsafe iteration patterns (for...in, lodash deep-merge).
 *   - Thousands of content entries with large top_logprobs arrays,
 *     causing O(n²) memory amplification during JSON.stringify.
 *   - Non-finite logprob values (NaN, Infinity) that produce garbage
 *     in downstream probability calculations.
 *   - Non-string token values or non-integer bytes that cause type
 *     confusion in MCP clients.
 *   - Arbitrary extra properties beyond the expected fields.
 *
 * Returns a clean allowlist-reconstructed object with only the fields
 * defined by the Logprobs type, or `undefined` if the input is invalid.
 * Matches the sanitization pattern applied by `sanitizeUpstreamUsage`,
 * the `embed_text` embedding sanitizer, and the `decide` answer sanitizer.
 */
export function sanitizeLogprobs(logprobs: unknown): SanitizedLogprobs | undefined {
  if (!logprobs || typeof logprobs !== 'object' || Array.isArray(logprobs)) return undefined;

  const raw = logprobs as Record<string, unknown>;

  // Reject if top-level has prototype-pollution keys
  for (const key of Object.keys(raw)) {
    if (UNSAFE_KEYS.has(key)) return undefined;
  }

  const content = sanitizeLogprobContentArray(raw.content);
  const refusal = sanitizeLogprobContentArray(raw.refusal);

  // Return undefined when both arrays are empty — no useful data.
  if (!content && !refusal) return undefined;

  return { content, refusal };
}

export interface ExtractedText {
  text: string;
  /** True when `text` came from the reasoning trace (not a final answer). */
  reasonedOnly: boolean;
  finishReason: ChatCompletion.Choice['finish_reason'] | undefined;
  nativeFinishReason: string | undefined;
  reasoning?: string;
  usage?: ChatCompletion['usage'];
}

interface ChatMessageLike {
  role?: string;
  content?: string | Array<{ type: string; text?: string }> | null;
  reasoning?: string | null;
  reasoning_details?: Array<{ type: string; text?: string }> | null;
  refusal?: string | null;
}

interface ChoiceLike {
  native_finish_reason?: string | null;
}

export function readMaxResultTextChars(): number {
  const raw = process.env.OPENROUTER_MAX_RESULT_TEXT_CHARS;
  if (raw === undefined || raw === '') return DEFAULT_MAX_RESULT_TEXT_CHARS;
  if (raw === '0') return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_RESULT_TEXT_CHARS;
}

export function capResultText(text: string): { text: string; truncated: boolean } {
  const max = readMaxResultTextChars();
  if (max <= 0 || text.length <= max) return { text, truncated: false };
  const omitted = text.length - max;
  const marker = `\n\n[… truncated — ${omitted} chars omitted; set OPENROUTER_MAX_RESULT_TEXT_CHARS=0 to disable]`;
  return { text: text.slice(0, max) + marker, truncated: true };
}

function extractReasoning(msg: ChatMessageLike): string | undefined {
  if (typeof msg.reasoning === 'string' && msg.reasoning.length > 0) return msg.reasoning;
  if (Array.isArray(msg.reasoning_details) && msg.reasoning_details.length > 0) {
    const joined = msg.reasoning_details
      .filter((d) => typeof d.text === 'string')
      .map((d) => d.text!)
      .join('\n');
    if (joined.length > 0) return joined;
  }
  return undefined;
}

function extractContentText(content: ChatMessageLike['content']): string {
  if (typeof content === 'string' && content.length > 0) return content;
  if (Array.isArray(content)) {
    const parts = content
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text ?? '');
    return parts.join('');
  }
  return '';
}

function emptyExtracted(
  finishReason: ChatCompletion.Choice['finish_reason'] | undefined,
  nativeFinishReason: string | undefined,
  usage: ChatCompletion['usage'] | undefined,
): ExtractedText {
  return {
    text: '',
    reasonedOnly: false,
    finishReason,
    nativeFinishReason,
    usage,
  };
}

export function extractCompletionText(completion: ChatCompletion): ExtractedText {
  try {
    const choice = completion.choices?.[0];
    const msg = choice?.message as unknown as ChatMessageLike | undefined;
    const finishReason = choice?.finish_reason;
    const nativeFinishReason =
      (choice as unknown as ChoiceLike | undefined)?.native_finish_reason ?? undefined;
    const usage = completion.usage ?? undefined;

    if (!msg) {
      return emptyExtracted(finishReason, nativeFinishReason, usage);
    }

    const reasoning = extractReasoning(msg);

    if (typeof msg.refusal === 'string' && msg.refusal.length > 0) {
      return {
        text: msg.refusal,
        reasonedOnly: false,
        finishReason,
        nativeFinishReason,
        reasoning,
        usage,
      };
    }

    const contentText = extractContentText(msg.content);
    if (contentText.length > 0) {
      return {
        text: contentText,
        reasonedOnly: false,
        finishReason,
        nativeFinishReason,
        reasoning,
        usage,
      };
    }

    if (reasoning && reasoning.length > 0) {
      return {
        text: reasoning,
        reasonedOnly: true,
        finishReason,
        nativeFinishReason,
        reasoning,
        usage,
      };
    }

    return emptyExtracted(finishReason, nativeFinishReason, usage);
  } catch {
    return emptyExtracted(undefined, undefined, undefined);
  }
}

/**
 * If the extracted response is reasoning-only and was cut off by
 * `max_tokens`, return a structured INVALID_INPUT suggesting the caller
 * raise the budget. Otherwise return `null` (let the caller format the
 * success response).
 */
export function detectReasoningCutoff(extracted: ExtractedText): ToolErrorResult | null {
  if (extracted.reasonedOnly && extracted.finishReason === 'length') {
    return toolError(
      ErrorCode.INVALID_INPUT,
      'Model exhausted max_tokens during internal reasoning without emitting a final answer. ' +
        'Raise max_tokens or choose a non-reasoning model.',
      {
        finish_reason: extracted.finishReason,
        reasoning_preview: extracted.text.slice(0, 200),
        usage: extracted.usage
          ? sanitizeUpstreamUsage(extracted.usage as unknown as Record<string, unknown>)
          : undefined,
      },
    );
  }
  return null;
}

/**
 * Classify an empty-text completion into the correct `ErrorCode` based on
 * `finish_reason`. Previously every handler used `ErrorCode.INTERNAL` for
 * this case, which is misleading when the model was content-filtered or
 * hit `max_tokens` without emitting text. `generate_audio` already handled
 * `content_filter` correctly; this brings parity to all chat/analyze tools.
 */
export function classifyEmptyCompletion(extracted: ExtractedText, label: string): ToolErrorResult {
  const details: Record<string, unknown> = {
    finish_reason: extracted.finishReason,
  };
  if (extracted.nativeFinishReason) {
    details.native_finish_reason = extracted.nativeFinishReason;
  }

  switch (extracted.finishReason) {
    case 'content_filter':
      return toolError(
        ErrorCode.UPSTREAM_REFUSED,
        `${label} was blocked by the content filter.`,
        details,
        {
          suggestions: [
            'Rephrase the prompt — the model content filter blocked the request',
            'Try a different model or provider via provider.order',
          ],
        },
      );
    case 'length':
      return toolError(
        ErrorCode.INVALID_INPUT,
        `${label} hit max_tokens without producing output. Raise max_tokens or shorten the input.`,
        details,
        {
          suggestions: [
            'Raise max_tokens',
            'Shorten the input messages',
            'Use a model with a larger context window',
          ],
        },
      );
    case 'tool_calls':
    case 'function_call':
      return toolError(
        ErrorCode.INVALID_INPUT,
        `${label} responded with tool calls instead of text. ` +
          'This MCP tool does not support multi-turn tool execution — ' +
          'use a prompt or model that generates direct text output.',
        details,
        {
          suggestions: [
            'Rephrase the prompt so the model responds with text instead of calling tools',
            'Use a different model that does not default to tool calling for this input',
            'Remove any tools or function definitions from the conversation context',
          ],
        },
      );
    default:
      return toolError(ErrorCode.INTERNAL, `${label} returned no textual content.`, details);
  }
}

/**
 * Sanitize usage from a ChatCompletion response before forwarding to MCP
 * clients.  The OpenAI SDK types `usage` fields as `number`, but at
 * runtime the upstream could return anything — including prototype-
 * pollution keys, non-finite numbers, strings, or arbitrary extra
 * properties.  Previously `toUsageMeta` manually picked three fields
 * without validating their types; this delegates to the shared
 * `sanitizeUpstreamUsage` allowlist for consistency with `embed_text`,
 * `decide`, `rerank`, `speech_to_text`, and `generate_image_dedicated`.
 */
export function toUsageMeta(
  usage: ChatCompletion['usage'] | undefined,
): Record<string, unknown> | undefined {
  if (!usage) return undefined;
  const safe = sanitizeUpstreamUsage(usage as unknown as Record<string, unknown>);
  return safe ? { usage: safe } : undefined;
}

export interface BuildMetaOptions {
  includeReasoning?: boolean;
  extra?: Record<string, unknown>;
}

export function buildCompletionMeta(
  extracted: ExtractedText,
  opts: BuildMetaOptions = {},
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    finish_reason: extracted.finishReason,
  };
  if (extracted.nativeFinishReason) {
    meta.native_finish_reason = extracted.nativeFinishReason;
  }
  if (opts.includeReasoning && extracted.reasoning && !extracted.reasonedOnly) {
    const capped = capResultText(extracted.reasoning);
    meta.reasoning = capped.text;
    if (capped.truncated) meta.reasoning_truncated = true;
  }
  const usageMeta = toUsageMeta(extracted.usage);
  if (usageMeta) Object.assign(meta, usageMeta);
  if (opts.extra) Object.assign(meta, opts.extra);
  return meta;
}
