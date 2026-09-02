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
    if ('content' in msg && msg.content === null) {
      return toolError(ErrorCode.INVALID_INPUT, `Message at index ${i} has null content.`);
    }
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
  if (input.online) {
    const plugin: Record<string, unknown> = { id: 'web' };
    if (typeof input.web_max_results === 'number' && input.web_max_results > 0) {
      plugin.max_results = input.web_max_results;
    }
    body.plugins = [plugin];
  }
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
