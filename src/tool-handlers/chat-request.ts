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
}

export function readIncludeReasoningDefault(): boolean {
  const raw = (process.env.OPENROUTER_INCLUDE_REASONING ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function validateChatMessages(
  messages: ChatCompletionMessageParam[] | undefined,
): ToolErrorResult | null {
  if (!messages?.length) {
    return toolError(ErrorCode.INVALID_INPUT, 'Messages array cannot be empty.');
  }
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
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

const VALID_REASONING_EFFORTS = new Set(['low', 'medium', 'high']);

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
  if (responseFormat.type === 'json_schema') {
    const schema = responseFormat.json_schema;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        'response_format.json_schema is required when type is "json_schema". ' +
          'It must be an object with at least a "name" and "schema" field.',
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
  }
  return null;
}

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
  }
  if (webBlockedDomains !== undefined) {
    if (!Array.isArray(webBlockedDomains)) {
      return toolError(ErrorCode.INVALID_INPUT, 'web_blocked_domains must be an array of strings.');
    }
    for (let i = 0; i < webBlockedDomains.length; i++) {
      if (typeof webBlockedDomains[i] !== 'string' || !webBlockedDomains[i]!.trim()) {
        return toolError(
          ErrorCode.INVALID_INPUT,
          `web_blocked_domains[${i}] must be a non-empty string.`,
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
