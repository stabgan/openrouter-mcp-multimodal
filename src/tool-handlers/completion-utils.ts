/**
 * Shared helpers for tools that call `openai.chat.completions.create` and
 * return the assistant's message as text. Handles:
 *   - plain string content (the common case)
 *   - multimodal array content (concatenate text parts)
 *   - reasoning-only responses (`content: null` + `reasoning`/`reasoning_details`)
 *   - `finish_reason === 'length'` — warn the caller so they know to raise
 *     `max_tokens` instead of silently getting nothing back.
 */
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import { ErrorCode, toolError, type ToolErrorResult } from '../errors.js';

export interface ExtractedText {
  text: string;
  /** True when `text` came from the reasoning trace (not a final answer). */
  reasonedOnly: boolean;
  finishReason: ChatCompletion.Choice['finish_reason'] | undefined;
  /**
   * OpenRouter's `native_finish_reason`, when present. Carries the
   * provider-native value before OpenRouter normalizes it. Surfaced in
   * `_meta.native_finish_reason` for debuggability.
   */
  nativeFinishReason: string | undefined;
  /**
   * Raw reasoning trace (content of `reasoning` or joined `reasoning_details`).
   * Populated whenever the upstream response carried one, even when the
   * assistant also produced a final `content` answer. Surfaced to callers
   * via `_meta.reasoning` when they opt in with `include_reasoning: true`.
   */
  reasoning?: string;
  usage?: ChatCompletion['usage'];
}

interface ChatMessageLike {
  role?: string;
  content?: string | Array<{ type: string; text?: string }> | null;
  reasoning?: string | null;
  reasoning_details?: Array<{ type: string; text?: string }> | null;
}

interface ChoiceLike {
  native_finish_reason?: string | null;
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

export function extractCompletionText(completion: ChatCompletion): ExtractedText {
  const choice = completion.choices?.[0];
  const msg = choice?.message as unknown as ChatMessageLike | undefined;
  const finishReason = choice?.finish_reason;
  // `native_finish_reason` is an OpenRouter extension, not in the OpenAI
  // SDK types — read it via an unknown-cast.
  const nativeFinishReason =
    (choice as unknown as ChoiceLike | undefined)?.native_finish_reason ?? undefined;
  const usage = completion.usage ?? undefined;

  if (!msg) {
    return {
      text: '',
      reasonedOnly: false,
      finishReason,
      nativeFinishReason: nativeFinishReason ?? undefined,
      usage,
    };
  }

  const { content } = msg;
  const reasoning = extractReasoning(msg);

  if (typeof content === 'string' && content.length > 0) {
    return {
      text: content,
      reasonedOnly: false,
      finishReason,
      nativeFinishReason: nativeFinishReason ?? undefined,
      reasoning,
      usage,
    };
  }
  if (Array.isArray(content)) {
    const parts = content
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text ?? '');
    const joined = parts.join('');
    if (joined.length > 0) {
      return {
        text: joined,
        reasonedOnly: false,
        finishReason,
        nativeFinishReason: nativeFinishReason ?? undefined,
        reasoning,
        usage,
      };
    }
  }

  if (reasoning && reasoning.length > 0) {
    return {
      text: reasoning,
      reasonedOnly: true,
      finishReason,
      nativeFinishReason: nativeFinishReason ?? undefined,
      reasoning,
      usage,
    };
  }

  return {
    text: '',
    reasonedOnly: false,
    finishReason,
    nativeFinishReason: nativeFinishReason ?? undefined,
    usage,
  };
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
          ? {
              prompt_tokens: extracted.usage.prompt_tokens,
              completion_tokens: extracted.usage.completion_tokens,
              total_tokens: extracted.usage.total_tokens,
            }
          : undefined,
      },
    );
  }
  return null;
}

export function toUsageMeta(
  usage: ChatCompletion['usage'] | undefined,
): Record<string, unknown> | undefined {
  if (!usage) return undefined;
  return {
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    },
  };
}

/**
 * Build the common `_meta` shape for chat-completion-derived tools.
 * Folds in:
 *  - normalized and native finish reasons (from the choice)
 *  - optional `reasoning` trace (when the caller opted in)
 *  - token usage (prompt / completion / total)
 *  - server version stamp
 *
 * Caller can pass `extra` to merge additional keys (cache metadata,
 * content_is_untrusted, etc.) without repeating this boilerplate.
 */
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
    meta.reasoning = extracted.reasoning;
  }
  const usageMeta = toUsageMeta(extracted.usage);
  if (usageMeta) Object.assign(meta, usageMeta);
  if (opts.extra) Object.assign(meta, opts.extra);
  return meta;
}
