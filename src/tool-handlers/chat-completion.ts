import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions.js';
import { ErrorCode, toolError } from '../errors.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import {
  extractCompletionText,
  detectReasoningCutoff,
  toUsageMeta,
} from './completion-utils.js';
import {
  type ProviderRoutingOptions,
  readProviderDefaults,
  mergeProviderOptions,
  buildProviderBody,
  resolveMaxTokens,
} from './provider-routing.js';

const DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

export interface ChatCompletionToolRequest {
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
}

export async function handleChatCompletion(
  request: { params: { arguments: ChatCompletionToolRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const { messages, model, temperature, max_tokens, provider } = request.params.arguments ?? {
    messages: [],
  };

  if (!messages?.length) {
    return toolError(ErrorCode.INVALID_INPUT, 'Messages array cannot be empty.');
  }

  const providerOptions = mergeProviderOptions(readProviderDefaults(), provider);
  const providerBody = buildProviderBody(providerOptions);
  const effectiveMaxTokens = resolveMaxTokens(max_tokens);

  // Build the request body. `provider` is an OpenRouter extension not in
  // the OpenAI SDK's types, so we cast to unknown to thread it through.
  const body: Record<string, unknown> = {
    model: model || defaultModel || DEFAULT_MODEL,
    messages,
    temperature: temperature ?? 1,
  };
  if (typeof effectiveMaxTokens === 'number') body.max_tokens = effectiveMaxTokens;
  if (providerBody) body.provider = providerBody;

  let completion: ChatCompletion;
  try {
    completion = (await openai.chat.completions.create(
      body as unknown as Parameters<typeof openai.chat.completions.create>[0],
    )) as ChatCompletion;
  } catch (err) {
    return classifyUpstreamError(err);
  }

  const extracted = extractCompletionText(completion);
  const cutoff = detectReasoningCutoff(extracted);
  if (cutoff) return cutoff;

  if (!extracted.text) {
    return toolError(ErrorCode.INTERNAL, 'Model returned no textual content.', {
      finish_reason: extracted.finishReason,
    });
  }

  return {
    content: [{ type: 'text' as const, text: extracted.text }],
    _meta: {
      finish_reason: extracted.finishReason,
      ...(toUsageMeta(extracted.usage) ?? {}),
    },
  };
}
