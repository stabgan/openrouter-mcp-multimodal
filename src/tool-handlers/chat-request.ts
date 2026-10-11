import type OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { ErrorCode, toolError, type ToolErrorResult } from '../errors.js';
import {
  type ProviderRoutingOptions,
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  resolveMaxTokens,
} from './provider-routing.js';
import { type CacheOptions, buildCacheHeaders } from './cache.js';

export const DEFAULT_CHAT_MODEL = 'google/gemma-4-26b-a4b-it:free';

/**
 * Model IDs follow the `org/model-name[:suffix]` pattern — 256 chars is
 * generous for any real identifier while preventing multi-megabyte strings
 * from inflating API request bodies, log entries, and MCP responses.
 * Shared by all tool handlers that accept a model parameter.
 */
export const MAX_MODEL_ID_LENGTH = 256;

/** Shared request shape for sync and async chat completion tools. */
export interface ChatToolRequest extends CacheOptions {
  model?: string;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  max_tokens?: number;
  provider?: ProviderRoutingOptions;
  include_reasoning?: boolean;
  online?: boolean;
  web_max_results?: number;
  /** Block specific domains from web search results. */
  web_blocked_domains?: string[];
  /**
   * Enable `openrouter:fusion` — multi-model deliberation. A panel of models
   * answers in parallel, an analyst synthesizes. Adds ~2-5x latency but
   * higher quality for complex prompts.
   */
  fusion?: boolean;
  /**
   * Enable `openrouter:subagent` — lets the model delegate subtasks to a
   * smaller, cheaper worker model mid-generation.
   */
  subagent?: boolean | { model?: string };
  /**
   * Enable `openrouter:response_healing` — automatically fix malformed JSON
   * responses (missing brackets, trailing commas, markdown wrappers).
   * Reduces JSON defects by 80%+.
   */
  response_healing?: boolean;
  /**
   * Request structured output from the model.
   *
   * `{ type: "json_object" }` — forces valid JSON output.
   * `{ type: "json_schema", json_schema: { name, schema, strict? } }` — structured output
   * with schema enforcement (OpenAI-compatible).
   * `{ type: "text" }` — plain text (default, equivalent to omitting).
   */
  response_format?: { type: string; [key: string]: unknown };
  /**
   * Control reasoning effort for thinking models (o1, o3, Claude extended
   * thinking, etc.). Higher effort = more reasoning tokens = higher quality
   * but slower and more expensive. Passed through to the provider.
   */
  reasoning_effort?: string;
  /**
   * Up to 4 sequences where the API will stop generating further tokens.
   * Can be a single string or an array of strings.
   */
  stop?: string | string[];
  /** Nucleus sampling — alternative to temperature. Between 0 and 1. */
  top_p?: number;
  /** Penalize new tokens based on their existing frequency in the text so far. Between -2 and 2. */
  frequency_penalty?: number;
  /** Penalize new tokens based on whether they appear in the text so far. Between -2 and 2. */
  presence_penalty?: number;
  logprobs?: boolean;
  top_logprobs?: number;
  seed?: number;
}

export function readIncludeReasoningDefault(): boolean {
  const raw = (process.env.OPENROUTER_INCLUDE_REASONING ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Maximum number of messages in a single chat completion request. Every
 * other array-accepting validator caps its input (embed_text: 2 048, rerank:
 * 1 000, decide: 50, etc.). Without a ceiling here, a malicious MCP client
 * can send millions of messages — exhausting memory during the validation
 * loop, `buildChatCompletionBody`, and `JSON.stringify` for the outbound
 * request. 2 000 is generous for any real conversation, including heavy
 * multi-turn tool-call exchanges.
 */
const MAX_MESSAGES = 2000;

/**
 * Aggregate content size limit across all messages (characters).
 *
 * Per-message count limits alone allow 2 000 messages × unbounded content
 * each — potentially multi-GB of payload that exhausts memory during
 * `JSON.stringify` in the OpenAI SDK.  Every other array-accepting handler
 * has an aggregate size cap:
 *   - `embed_text`: `MAX_TOTAL_INPUT_CHARS` = 10 MB
 *   - `rerank`: `MAX_TOTAL_INPUT_CHARS` = 10 MB
 *   - `decide`: `MAX_QUESTIONS_BYTES` = 1 MB
 *
 * Chat messages can legitimately include inline multimodal content (data-URL
 * images up to 20 MB each, base64 audio), so the ceiling is higher than
 * text-only handlers.  50 MB covers the largest realistic conversation
 * (several inline images + extensive text history) while preventing the
 * multi-GB worst case.  Matches `MAX_JSON_RESPONSE_BYTES` (50 MiB) used
 * for API response capping.
 */
const MAX_MESSAGES_TOTAL_CHARS = 50_000_000;

/**
 * Estimate the character count of a message's content without serialization.
 *
 * Inspects only the known large-payload fields (text strings, image URL
 * strings, audio data strings) to avoid expensive `JSON.stringify` calls on
 * content that can be tens of megabytes per part.  Structural overhead
 * (role, keys, brackets) is negligible and safely ignored — the aggregate
 * cap is generous enough that structural bytes never tip it.
 */
function estimateContentChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    if (typeof part === 'string') {
      total += part.length;
      continue;
    }
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    // Text content parts
    if (typeof p.text === 'string') total += p.text.length;
    // Image URL parts — can contain multi-MB data URLs
    if (p.image_url && typeof p.image_url === 'object') {
      const url = (p.image_url as Record<string, unknown>).url;
      if (typeof url === 'string') total += url.length;
    }
    // Audio parts — can contain multi-MB base64 data
    if (p.input_audio && typeof p.input_audio === 'object') {
      const data = (p.input_audio as Record<string, unknown>).data;
      if (typeof data === 'string') total += data.length;
    }
    // Video URL parts — can contain multi-MB data URLs
    if (p.video_url && typeof p.video_url === 'object') {
      const url = (p.video_url as Record<string, unknown>).url;
      if (typeof url === 'string') total += url.length;
    }
  }
  return total;
}

export function validateChatMessages(
  messages: ChatCompletionMessageParam[] | undefined,
): ToolErrorResult | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return toolError(ErrorCode.INVALID_INPUT, 'Messages array cannot be empty.');
  }
  if (messages.length > MAX_MESSAGES) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `Too many messages: ${messages.length} exceeds max ${MAX_MESSAGES}. Summarize earlier messages or split into multiple requests.`,
    );
  }
  let totalContentChars = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // Null, undefined, or primitive entries crash on property access — reject
    // them cleanly instead of letting an unhandled TypeError bubble up.
    if (msg == null || typeof msg !== 'object' || Array.isArray(msg)) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `Message at index ${i} must be an object with at least a "role" field.`,
      );
    }
    const role = (msg as { role?: string }).role;
    if (typeof role !== 'string' || role.trim().length === 0) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `Message at index ${i} has an empty or missing role.`,
      );
    }
    // Assistant messages may legitimately have content: null when tool_calls
    // is present (standard OpenAI multi-turn tool-use pattern).
    if ('content' in msg && msg.content === null && role !== 'assistant') {
      return toolError(ErrorCode.INVALID_INPUT, `Message at index ${i} has null content.`);
    }
    // Reject wrong content types (boolean, number, plain object). Valid
    // content is string, Array<ContentPart>, null (assistant only), or absent.
    // MCP clients that ignore the JSON schema can send numbers, booleans, or
    // plain objects — forwarding these produces confusing upstream API errors.
    if (
      'content' in msg &&
      msg.content !== null &&
      msg.content !== undefined &&
      typeof msg.content !== 'string' &&
      !Array.isArray(msg.content)
    ) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `Message at index ${i} has invalid content type (expected string or array, got ${typeof msg.content}).`,
      );
    }
    // Accumulate content size for the aggregate cap — fail fast before
    // processing all 2 000 messages if we're already over budget.
    if ('content' in msg) {
      totalContentChars += estimateContentChars(msg.content);
      if (totalContentChars > MAX_MESSAGES_TOTAL_CHARS) {
        return toolError(
          ErrorCode.INVALID_INPUT,
          `Messages total content size (~${totalContentChars} chars) exceeds max ${MAX_MESSAGES_TOTAL_CHARS}. ` +
            'Summarize earlier messages, remove inline media, or split into multiple requests.',
        );
      }
    }
  }
  return null;
}

export function validateTemperature(temperature: number | undefined): ToolErrorResult | null {
  if (temperature === undefined) return null;
  if (
    typeof temperature !== 'number' ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 2
  ) {
    return toolError(ErrorCode.INVALID_INPUT, 'temperature must be a number between 0 and 2.');
  }
  return null;
}

export function validateMaxTokens(max_tokens: number | undefined): ToolErrorResult | null {
  if (max_tokens === undefined) return null;
  if (
    typeof max_tokens !== 'number' ||
    !Number.isFinite(max_tokens) ||
    max_tokens <= 0 ||
    !Number.isInteger(max_tokens)
  ) {
    return toolError(ErrorCode.INVALID_INPUT, 'max_tokens must be a positive integer.');
  }
  return null;
}

const VALID_RESPONSE_FORMAT_TYPES = new Set(['text', 'json_object', 'json_schema']);

/**
 * Maximum serialized size for the entire `response_format` object (bytes).
 * Every other user-controlled complex object that gets serialized into outbound
 * API requests has a size cap (`MAX_STATE_BYTES` in `decide`, `MAX_TOTAL_INPUT_CHARS`
 * in `embed_text`/`rerank`). Without this limit, a malicious MCP client can inject
 * arbitrary extra properties on `response_format` (for any type, not just
 * `json_schema`) that bypass field-level checks and exhaust memory during
 * `JSON.stringify` of the outbound request body. 100 KB is generous for any
 * real response format including a full JSON schema.
 */
const MAX_RESPONSE_FORMAT_BYTES = 100_000;

/** Keys that could cause prototype pollution when iterated with Object.entries/for-in. */
const UNSAFE_RESPONSE_FORMAT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Shallow check for prototype-pollution keys on a user-supplied object.
 * Matches the `hasUnsafeKey` pattern used in the `decide`, `provider-routing`,
 * and `search-models` handlers.
 */
function responseFormatHasUnsafeKey(obj: Record<string, unknown>): string | null {
  for (const key of Object.keys(obj)) {
    if (UNSAFE_RESPONSE_FORMAT_KEYS.has(key)) return key;
  }
  return null;
}

const VALID_REASONING_EFFORTS = new Set(['low', 'medium', 'high']);

/**
 * Length limit for reasoning_effort strings.  Real values are short keywords
 * (low, medium, high); without a ceiling a malicious MCP client can inject
 * a multi-megabyte string that inflates the serialized request body and log
 * entries.  64 chars allows for any future values OpenRouter may add.
 */
const MAX_REASONING_EFFORT_LENGTH = 64;

export function validateReasoningEffort(
  reasoningEffort: string | undefined,
): ToolErrorResult | null {
  if (reasoningEffort === undefined) return null;
  if (typeof reasoningEffort !== 'string' || !reasoningEffort.trim()) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `reasoning_effort must be a non-empty string. Common values: ${[...VALID_REASONING_EFFORTS].join(', ')}.`,
    );
  }
  if (reasoningEffort.length > MAX_REASONING_EFFORT_LENGTH) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `reasoning_effort exceeds max length ${MAX_REASONING_EFFORT_LENGTH} (got ${reasoningEffort.length}). Common values: ${[...VALID_REASONING_EFFORTS].join(', ')}.`,
    );
  }
  return null;
}

const MAX_STOP_SEQUENCES = 4;
/**
 * Per-sequence character limit for stop strings.  Real stop sequences are
 * short tokens (e.g. "\n\n", "###", "END"); without a ceiling a malicious
 * MCP client can send up to 4 multi-megabyte strings that inflate the
 * serialized request body and log entries.  1 024 chars is generous for any
 * real stop sequence while closing the DoS vector.  Matches the per-element
 * bounding pattern applied by embed_text (MAX_TEXT_LENGTH), rerank
 * (MAX_DOCUMENT_LENGTH), decide (MAX_CRITERIA_VALUE_LENGTH), and
 * text_to_speech (MAX_INPUT_LENGTH).
 */
const MAX_STOP_LENGTH = 1024;

export function validateStop(stop: string | string[] | undefined): ToolErrorResult | null {
  if (stop === undefined) return null;
  if (typeof stop === 'string') {
    if (stop.length === 0) {
      return toolError(ErrorCode.INVALID_INPUT, 'stop must be a non-empty string or array.');
    }
    if (stop.length > MAX_STOP_LENGTH) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `stop sequence exceeds max length ${MAX_STOP_LENGTH} (got ${stop.length}).`,
      );
    }
    return null;
  }
  if (!Array.isArray(stop)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      'stop must be a string or an array of up to 4 strings.',
    );
  }
  if (stop.length === 0 || stop.length > MAX_STOP_SEQUENCES) {
    return toolError(ErrorCode.INVALID_INPUT, `stop array must contain 1–4 strings.`);
  }
  for (let i = 0; i < stop.length; i++) {
    if (typeof stop[i] !== 'string' || stop[i]!.length === 0) {
      return toolError(ErrorCode.INVALID_INPUT, `stop[${i}] must be a non-empty string.`);
    }
    if (stop[i]!.length > MAX_STOP_LENGTH) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `stop[${i}] exceeds max length ${MAX_STOP_LENGTH} (got ${stop[i]!.length}).`,
      );
    }
  }
  return null;
}

export function validateTopP(topP: number | undefined): ToolErrorResult | null {
  if (topP === undefined) return null;
  if (typeof topP !== 'number' || !Number.isFinite(topP) || topP < 0 || topP > 1) {
    return toolError(ErrorCode.INVALID_INPUT, 'top_p must be a number between 0 and 1.');
  }
  return null;
}

export function validatePenalty(value: number | undefined, name: string): ToolErrorResult | null {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -2 || value > 2) {
    return toolError(ErrorCode.INVALID_INPUT, `${name} must be a number between -2 and 2.`);
  }
  return null;
}

const MAX_TOP_LOGPROBS = 20;

export function validateLogprobs(
  logprobs: boolean | undefined,
  topLogprobs: number | undefined,
): ToolErrorResult | null {
  if (logprobs !== undefined && typeof logprobs !== 'boolean') {
    return toolError(ErrorCode.INVALID_INPUT, 'logprobs must be a boolean.');
  }
  if (topLogprobs !== undefined) {
    if (
      typeof topLogprobs !== 'number' ||
      !Number.isFinite(topLogprobs) ||
      !Number.isInteger(topLogprobs) ||
      topLogprobs < 0 ||
      topLogprobs > MAX_TOP_LOGPROBS
    ) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `top_logprobs must be an integer between 0 and ${MAX_TOP_LOGPROBS}.`,
      );
    }
    if (!logprobs) {
      return toolError(ErrorCode.INVALID_INPUT, 'top_logprobs requires logprobs: true to be set.');
    }
  }
  return null;
}

export function validateSeed(seed: number | undefined): ToolErrorResult | null {
  if (seed === undefined) return null;
  if (typeof seed !== 'number' || !Number.isFinite(seed) || !Number.isInteger(seed)) {
    return toolError(ErrorCode.INVALID_INPUT, 'seed must be an integer.');
  }
  return null;
}

/**
 * Validate a parameter that must be a boolean when present.
 *
 * Several chat-completion parameters (`fusion`, `response_healing`,
 * `online`, `include_reasoning`) toggle server-side features via truthy
 * checks in `buildChatCompletionBody`.  Without explicit type validation,
 * a malicious MCP client can send non-boolean truthy values (strings,
 * numbers, objects, arrays) that silently enable features.  While the
 * downstream effect is the same as `true`, accepting wrong types is
 * inconsistent with every other validated parameter and masks caller bugs.
 * Matches the `typeof logprobs !== 'boolean'` check in `validateLogprobs`
 * and the `typeof return_documents !== 'boolean'` check in `rerank.ts`.
 */
export function validateBooleanParam(value: unknown, name: string): ToolErrorResult | null {
  if (value === undefined) return null;
  if (typeof value !== 'boolean') {
    return toolError(ErrorCode.INVALID_INPUT, `${name} must be a boolean.`);
  }
  return null;
}

/**
 * Validate the `subagent` parameter.
 *
 * `subagent` is the only chat parameter where user-controlled data (the
 * `model` field) flows into the outbound API request body yet had no
 * runtime validation — unlike every other parameter which has a dedicated
 * validator.  Without this check, a malicious MCP client can inject:
 *   - a non-string model value (number, nested object, array) that
 *     produces confusing upstream errors or inflates the request body;
 *   - an absurdly long model string that exceeds MAX_MODEL_ID_LENGTH,
 *     bypassing the cap enforced on the top-level `model` parameter.
 */
export function validateSubagent(
  subagent: boolean | { model?: string } | undefined,
): ToolErrorResult | null {
  if (subagent === undefined) return null;
  // Boolean form: true enables subagent, false is a no-op.
  if (typeof subagent === 'boolean') return null;
  // Object form: { model?: string } — delegates to a specific worker model.
  if (typeof subagent !== 'object' || subagent === null || Array.isArray(subagent)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      'subagent must be a boolean or an object with an optional "model" field.',
    );
  }
  const obj = subagent as Record<string, unknown>;
  if ('model' in obj && obj.model !== undefined) {
    if (typeof obj.model !== 'string' || !obj.model.trim()) {
      return toolError(ErrorCode.INVALID_INPUT, 'subagent.model must be a non-empty string.');
    }
    if (obj.model.length > MAX_MODEL_ID_LENGTH) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `subagent.model exceeds max length ${MAX_MODEL_ID_LENGTH} (got ${obj.model.length}).`,
      );
    }
  }
  return null;
}

export function validateResponseFormat(
  responseFormat: { type: string; [key: string]: unknown } | undefined,
): ToolErrorResult | null {
  if (responseFormat === undefined) return null;
  if (
    typeof responseFormat !== 'object' ||
    responseFormat === null ||
    Array.isArray(responseFormat)
  ) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      'response_format must be an object with a "type" field (e.g. { "type": "json_object" }).',
    );
  }
  if (typeof responseFormat.type !== 'string' || !responseFormat.type.trim()) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `response_format.type is required. Valid values: ${[...VALID_RESPONSE_FORMAT_TYPES].join(', ')}.`,
    );
  }
  if (!VALID_RESPONSE_FORMAT_TYPES.has(responseFormat.type)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `response_format.type '${responseFormat.type}' is not supported. Valid values: ${[...VALID_RESPONSE_FORMAT_TYPES].join(', ')}.`,
    );
  }
  // Block prototype-pollution keys on the top-level response_format object.
  // Every other user-supplied complex object that flows into outbound API
  // request bodies is checked: questions/state in decide, provider in
  // provider-routing, capabilities in search-models.  response_format was
  // the remaining gap — it is forwarded verbatim via
  // `body.response_format = input.response_format` in buildChatCompletionBody.
  // MCP clients that process structuredContent with unsafe iteration patterns
  // (for...in, lodash deep-merge, Object.assign spread) could be exploited
  // by a malicious upstream response that echoes the format object back.
  const unsafeRfKey = responseFormatHasUnsafeKey(responseFormat as Record<string, unknown>);
  if (unsafeRfKey) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `response_format contains unsafe key "${unsafeRfKey}".`,
    );
  }
  // Cap total serialized size for ALL non-text types.
  // `buildChatCompletionBody` filters out type: "text", so only json_object
  // and json_schema are serialized into the outbound request body.
  // Previously only json_schema's `json_schema` field was size-checked —
  // json_object had no size cap, and arbitrary extra properties on any type
  // could bypass the field-level check (e.g. a 50 MB unknown key alongside
  // a 10 KB json_schema).
  if (responseFormat.type !== 'text') {
    let formatSize: number;
    try {
      formatSize = JSON.stringify(responseFormat).length;
    } catch {
      return toolError(ErrorCode.INVALID_INPUT, 'response_format is not serializable.');
    }
    if (formatSize > MAX_RESPONSE_FORMAT_BYTES) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `response_format serialized size (${formatSize} bytes) exceeds max ${MAX_RESPONSE_FORMAT_BYTES}. Simplify the response format.`,
      );
    }
  }
  if (responseFormat.type === 'json_schema') {
    const schema = responseFormat.json_schema;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        'response_format.json_schema is required when type is "json_schema". ' +
          'It must be an object with at least a "name" and "schema" field.',
      );
    }
    // Block prototype-pollution keys on the json_schema wrapper object.
    // The inner `schema` (the actual JSON Schema) is not checked because
    // its property names are user-defined and "constructor" is a plausible
    // field name in a schema describing class definitions.  The wrapper
    // object has a fixed shape (name, schema, strict?) so dangerous keys
    // are never legitimate here.
    const unsafeJsKey = responseFormatHasUnsafeKey(schema as Record<string, unknown>);
    if (unsafeJsKey) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `response_format.json_schema contains unsafe key "${unsafeJsKey}".`,
      );
    }
    const s = schema as { name?: unknown; schema?: unknown };
    if (typeof s.name !== 'string' || !s.name.trim()) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        'response_format.json_schema.name must be a non-empty string.',
      );
    }
    if (!s.schema || typeof s.schema !== 'object') {
      return toolError(
        ErrorCode.INVALID_INPUT,
        'response_format.json_schema.schema must be a JSON Schema object.',
      );
    }
    // Per-field size check is no longer needed — the overall check above
    // already caps the entire response_format object (including json_schema).
  }
  return null;
}

/**
 * Upper bound for `web_max_results`. OpenRouter's web plugin returns at most
 * a handful of results per query; without a ceiling an attacker can send an
 * absurdly large value that the upstream ignores but that bloats the request
 * body and any downstream logging.
 */
const MAX_WEB_MAX_RESULTS = 100;
/**
 * Maximum number of blocked domains.  50 is generous for any real use case
 * and prevents an unbounded array from inflating the serialized request body.
 */
const MAX_WEB_BLOCKED_DOMAINS = 50;
/**
 * Per-domain character limit.  RFC 1035 limits DNS names to 253 characters;
 * anything longer cannot be a valid domain and is rejected early to prevent
 * oversized payloads.  Matches the per-element bounding pattern applied by
 * `embed_text` (MAX_TEXT_LENGTH), `rerank` (MAX_DOCUMENT_LENGTH), and
 * `decide` (MAX_CRITERIA_VALUE_LENGTH).
 */
const MAX_WEB_BLOCKED_DOMAIN_LENGTH = 253;

export function validateWebSearchOptions(
  webMaxResults: number | undefined,
  webBlockedDomains: string[] | undefined,
  online?: boolean,
): ToolErrorResult | null {
  if (webMaxResults !== undefined) {
    if (
      typeof webMaxResults !== 'number' ||
      !Number.isFinite(webMaxResults) ||
      !Number.isInteger(webMaxResults) ||
      webMaxResults < 1
    ) {
      return toolError(ErrorCode.INVALID_INPUT, 'web_max_results must be a positive integer.');
    }
    if (webMaxResults > MAX_WEB_MAX_RESULTS) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `web_max_results ${webMaxResults} exceeds max ${MAX_WEB_MAX_RESULTS}.`,
      );
    }
  }
  if (webBlockedDomains !== undefined) {
    if (!Array.isArray(webBlockedDomains)) {
      return toolError(ErrorCode.INVALID_INPUT, 'web_blocked_domains must be an array of strings.');
    }
    if (webBlockedDomains.length > MAX_WEB_BLOCKED_DOMAINS) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `web_blocked_domains has ${webBlockedDomains.length} entries — max ${MAX_WEB_BLOCKED_DOMAINS}.`,
      );
    }
    for (let i = 0; i < webBlockedDomains.length; i++) {
      if (typeof webBlockedDomains[i] !== 'string' || !webBlockedDomains[i]!.trim()) {
        return toolError(
          ErrorCode.INVALID_INPUT,
          `web_blocked_domains[${i}] must be a non-empty string.`,
        );
      }
      if (webBlockedDomains[i]!.length > MAX_WEB_BLOCKED_DOMAIN_LENGTH) {
        return toolError(
          ErrorCode.INVALID_INPUT,
          `web_blocked_domains[${i}] exceeds max length ${MAX_WEB_BLOCKED_DOMAIN_LENGTH} (got ${webBlockedDomains[i]!.length}). DNS names cannot exceed 253 characters.`,
        );
      }
    }
  }
  // Catch the common mistake of setting web search params without enabling online mode.
  const hasActiveWebSearchParams =
    webMaxResults !== undefined ||
    (Array.isArray(webBlockedDomains) && webBlockedDomains.length > 0);
  if (hasActiveWebSearchParams && !online) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      'web_max_results and web_blocked_domains require `online: true` to take effect. ' +
        'Set online: true to enable web search, or remove these parameters.',
    );
  }
  return null;
}

export function buildChatCompletionBody(
  input: ChatToolRequest & { model: string },
): Record<string, unknown> {
  const providerBody = buildProviderBody(
    mergeProviderOptions(readProviderDefaults(), input.provider),
  );
  const effectiveMaxTokens = resolveMaxTokens(input.max_tokens);
  const wantsReasoning = input.include_reasoning ?? readIncludeReasoningDefault();

  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? 1,
  };
  if (typeof effectiveMaxTokens === 'number') body.max_tokens = effectiveMaxTokens;
  if (input.stop !== undefined) body.stop = input.stop;
  if (input.top_p !== undefined) body.top_p = input.top_p;
  if (input.frequency_penalty !== undefined) body.frequency_penalty = input.frequency_penalty;
  if (input.presence_penalty !== undefined) body.presence_penalty = input.presence_penalty;
  if (input.logprobs === true) body.logprobs = true;
  if (typeof input.top_logprobs === 'number') body.top_logprobs = input.top_logprobs;
  if (typeof input.seed === 'number') body.seed = input.seed;
  if (providerBody) body.provider = providerBody;
  if (wantsReasoning) body.include_reasoning = true;
  if (input.reasoning_effort?.trim()) body.reasoning_effort = input.reasoning_effort.trim();
  if (input.response_format && input.response_format.type !== 'text') {
    body.response_format = input.response_format;
  }
  if (input.online) {
    const plugin: Record<string, unknown> = { id: 'web' };
    if (typeof input.web_max_results === 'number' && input.web_max_results > 0) {
      plugin.max_results = input.web_max_results;
    }
    if (input.web_blocked_domains?.length) {
      plugin.blocked_domains = input.web_blocked_domains;
    }
    body.plugins = [plugin];
  }

  // OpenRouter server tools — executed server-side, no client implementation needed.
  const tools: Array<Record<string, unknown>> = [];
  if (input.fusion) {
    tools.push({ type: 'openrouter:fusion' });
  }
  if (input.subagent) {
    const subagentTool: Record<string, unknown> = { type: 'openrouter:subagent' };
    if (typeof input.subagent === 'object' && input.subagent.model) {
      subagentTool.parameters = { model: input.subagent.model };
    }
    tools.push(subagentTool);
  }
  if (input.response_healing) {
    body.plugins = [
      ...((body.plugins as Array<Record<string, unknown>>) ?? []),
      { id: 'response_healing' },
    ];
  }
  if (tools.length) body.tools = tools;
  return body;
}

export function buildChatCompletionRequestOpts(
  cache: CacheOptions,
): { headers: Record<string, string> } | undefined {
  const headers = buildCacheHeaders(cache);
  return Object.keys(headers).length > 0 ? { headers } : undefined;
}

export type OpenAIChatCreateBody = Parameters<OpenAI['chat']['completions']['create']>[0];

export function asOpenAIChatBody(body: Record<string, unknown>): OpenAIChatCreateBody {
  return body as unknown as OpenAIChatCreateBody;
}
