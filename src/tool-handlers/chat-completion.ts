import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions.js';
import { ErrorCode, toolError } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import {
  extractCompletionText,
  detectReasoningCutoff,
  buildCompletionMeta,
} from './completion-utils.js';
import {
  type ProviderRoutingOptions,
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  resolveMaxTokens,
} from './provider-routing.js';
import {
  type CacheOptions,
  buildCacheHeaders,
  extractCacheMeta,
} from './cache.js';
import { awaitCompletionWithHeaders } from './openai-withresponse.js';

const DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

export interface ChatCompletionToolRequest extends CacheOptions {
  model?: string;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  max_tokens?: number;
  /**
   * OpenRouter provider routing overrides. Merges on top of the
   * `OPENROUTER_PROVIDER_*` env-var defaults. See
   * https://openrouter.ai/docs/features/provider-routing
   */
  provider?: ProviderRoutingOptions;
  /**
   * Surface the model's chain-of-thought trace on `_meta.reasoning` when
   * the upstream response carries one (DeepSeek R1, Gemini Thinking,
   * Claude Opus 4.7). Defaults to `false` or the value of
   * `OPENROUTER_INCLUDE_REASONING`.
   */
  include_reasoning?: boolean;
  /**
   * Enable OpenRouter's web-search plugin (Exa-backed). When true, the
   * plugin fetches current web results and merges them into the prompt.
   * Billed at $4 / 1000 results.
   */
  online?: boolean;
  /** Max web-search results when `online: true`. Default 5. */
  web_max_results?: number;
}

function readIncludeReasoningDefault(): boolean {
  const raw = (process.env.OPENROUTER_INCLUDE_REASONING ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export async function handleChatCompletion(
  request: { params: { arguments: ChatCompletionToolRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const args = request.params.arguments ?? ({ messages: [] } as ChatCompletionToolRequest);
  const {
    messages,
    model,
    temperature,
    max_tokens,
    provider,
    include_reasoning,
    online,
    web_max_results,
    cache,
    cache_ttl,
    cache_clear,
  } = args;

  if (!messages?.length) {
    return toolError(ErrorCode.INVALID_INPUT, 'Messages array cannot be empty.');
  }

  const providerOptions = mergeProviderOptions(readProviderDefaults(), provider);
  const providerBody = buildProviderBody(providerOptions);
  const effectiveMaxTokens = resolveMaxTokens(max_tokens);
  const wantsReasoning = include_reasoning ?? readIncludeReasoningDefault();

  // Build the request body. Several OpenRouter extensions aren't in the
  // OpenAI SDK types, so we assemble as `Record<string, unknown>` and cast
  // at the call site.
  const body: Record<string, unknown> = {
    model: model || defaultModel || DEFAULT_MODEL,
    messages,
    temperature: temperature ?? 1,
  };
  if (typeof effectiveMaxTokens === 'number') body.max_tokens = effectiveMaxTokens;
  if (providerBody) body.provider = providerBody;
  if (wantsReasoning) body.include_reasoning = true;
  if (online) {
    const plugin: Record<string, unknown> = { id: 'web' };
    if (typeof web_max_results === 'number' && web_max_results > 0) {
      plugin.max_results = web_max_results;
    }
    body.plugins = [plugin];
  }

  const headers = buildCacheHeaders({ cache, cache_ttl, cache_clear });
  const requestOpts = Object.keys(headers).length > 0 ? { headers } : undefined;

  let completion: ChatCompletion;
  let responseHeaders: Headers | undefined;
  try {
    const call = openai.chat.completions.create(
      body as unknown as Parameters<typeof openai.chat.completions.create>[0],
      requestOpts,
    );
    const { data, response } = await awaitCompletionWithHeaders(call);
    completion = data;
    responseHeaders = response?.headers;
  } catch (err) {
    return classifyUpstreamError(err);
  }

  const extracted = extractCompletionText(completion);
  const cutoff = detectReasoningCutoff(extracted);
  if (cutoff) return cutoff;

  if (!extracted.text) {
    return toolError(ErrorCode.INTERNAL, 'Model returned no textual content.', {
      finish_reason: extracted.finishReason,
      native_finish_reason: extracted.nativeFinishReason,
    });
  }

  const cacheMeta = extractCacheMeta(responseHeaders);
  const extra: Record<string, unknown> = { server_version: SERVER_VERSION };
  if (cacheMeta) extra.cache = cacheMeta;

  return {
    content: [{ type: 'text' as const, text: extracted.text }],
    _meta: buildCompletionMeta(extracted, {
      includeReasoning: wantsReasoning,
      extra,
    }),
  };
}
