import type OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import {
  type ProviderRoutingOptions,
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  resolveMaxTokens,
} from './provider-routing.js';
import { type CacheOptions, buildCacheHeaders } from './cache.js';

export const DEFAULT_CHAT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

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
