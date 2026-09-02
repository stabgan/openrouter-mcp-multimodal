import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import { ErrorCode, toolError } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import {
  extractCompletionText,
  detectReasoningCutoff,
  buildCompletionMeta,
  capResultText,
} from './completion-utils.js';
import { extractCacheMeta, validateCacheOptions } from './cache.js';
import { awaitCompletionWithHeaders } from './openai-withresponse.js';
import {
  DEFAULT_CHAT_MODEL,
  type ChatToolRequest,
  buildChatCompletionBody,
  buildChatCompletionRequestOpts,
  asOpenAIChatBody,
  readIncludeReasoningDefault,
  validateChatMessages,
  validateMaxTokens,
} from './chat-request.js';

export type ChatCompletionToolRequest = ChatToolRequest;

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

  const messagesError = validateChatMessages(messages);
  if (messagesError) return messagesError;

  const cacheError = validateCacheOptions({ cache, cache_ttl, cache_clear });
  if (cacheError) return cacheError;

  const maxTokensError = validateMaxTokens(max_tokens);
  if (maxTokensError) return maxTokensError;

  const wantsReasoning = include_reasoning ?? readIncludeReasoningDefault();

  const body = buildChatCompletionBody({
    messages,
    model: model || defaultModel || DEFAULT_CHAT_MODEL,
    temperature,
    max_tokens,
    provider,
    include_reasoning,
    online,
    web_max_results,
  });
  const requestOpts = buildChatCompletionRequestOpts({ cache, cache_ttl, cache_clear });

  let completion: ChatCompletion;
  let responseHeaders: Headers | undefined;
  try {
    const call = openai.chat.completions.create(asOpenAIChatBody(body), requestOpts);
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

  const capped = capResultText(extracted.text);
  if (capped.truncated) extra.result_truncated = true;

  return {
    content: [{ type: 'text' as const, text: capped.text }],
    _meta: buildCompletionMeta(extracted, {
      includeReasoning: wantsReasoning,
      extra,
    }),
  };
}
