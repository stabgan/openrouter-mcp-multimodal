import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions.js';
import { prepareImageUrl } from './image-utils.js';
import { ErrorCode, toolError, toolErrorFrom } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { classifyUpstreamError } from './openrouter-errors.js';
import {
  extractCompletionText,
  detectReasoningCutoff,
  buildCompletionMeta,
} from './completion-utils.js';
import {
  type CacheOptions,
  buildCacheHeaders,
  extractCacheMeta,
} from './cache.js';
import { awaitCompletionWithHeaders } from './openai-withresponse.js';

const DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

export interface AnalyzeImageToolRequest extends CacheOptions {
  image_path: string;
  question?: string;
  model?: string;
  /**
   * When true, attach Anthropic-style `cache_control: {type: 'ephemeral'}`
   * to the image block so Claude / Gemini 2.5+ prompt-caches it. Repeat
   * questions about the same image then cost ~0.1x on Anthropic and
   * ~0.25x on Gemini for the image input.
   */
  cache_input?: boolean;
}

export async function handleAnalyzeImage(
  request: { params: { arguments: AnalyzeImageToolRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const args = request.params.arguments ?? ({ image_path: '' } as AnalyzeImageToolRequest);
  const { image_path, question, model, cache_input, cache, cache_ttl, cache_clear } = args;

  if (!image_path) {
    return toolError(ErrorCode.INVALID_INPUT, 'image_path is required.');
  }

  let imageUrl: string;
  try {
    imageUrl = await prepareImageUrl(image_path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Blocked host')) return toolErrorFrom(ErrorCode.UPSTREAM_REFUSED, err);
    if (msg.toLowerCase().includes('too large')) {
      return toolErrorFrom(ErrorCode.RESOURCE_TOO_LARGE, err);
    }
    return toolErrorFrom(ErrorCode.INVALID_INPUT, err);
  }

  // Attach `cache_control` to the image block when requested. The openai
  // SDK doesn't type this field but passes it through to the server,
  // which forwards it to providers that support prompt caching.
  const imageBlock: Record<string, unknown> = {
    type: 'image_url',
    image_url: { url: imageUrl },
  };
  if (cache_input) imageBlock.cache_control = { type: 'ephemeral' };

  const headers = buildCacheHeaders({ cache, cache_ttl, cache_clear });
  const requestOpts = Object.keys(headers).length > 0 ? { headers } : undefined;

  let completion: ChatCompletion;
  let responseHeaders: Headers | undefined;
  try {
    const call = openai.chat.completions.create(
      {
        model: model || defaultModel || DEFAULT_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: question || "What's in this image?" },
              imageBlock,
            ],
          },
        ] as unknown as ChatCompletionMessageParam[],
      },
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
    return toolError(ErrorCode.INTERNAL, 'Vision model returned no textual content.', {
      finish_reason: extracted.finishReason,
    });
  }

  const cacheMeta = extractCacheMeta(responseHeaders);
  // Output originates from model interpretation of potentially
  // attacker-controlled image content (typography attacks, QR codes,
  // adversarial watermarks). Flag it so downstream agents know to treat
  // this text as data, not instructions. Inspired by ClawGuard (arxiv
  // 2604.11790) and tool-result-parsing defenses (2601.04795).
  const extra: Record<string, unknown> = {
    server_version: SERVER_VERSION,
    content_is_untrusted: true,
  };
  if (cacheMeta) extra.cache = cacheMeta;

  return {
    content: [{ type: 'text' as const, text: extracted.text }],
    _meta: buildCompletionMeta(extracted, { extra }),
  };
}
