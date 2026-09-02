/**
 * Helpers for chat completion responses — text extraction, reasoning, finish reasons.
 */
import type { ChatCompletion } from 'openai/resources/chat/completions.js';
import { ErrorCode, toolError, type ToolErrorResult } from '../errors.js';

/** Default cap for text returned in tool content / _meta (chars). Set OPENROUTER_MAX_RESULT_TEXT_CHARS=0 to disable. */
const DEFAULT_MAX_RESULT_TEXT_CHARS = 512_000;

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
      return emptyExtracted(finishReason, nativeFinishReason ?? undefined, usage);
    }

    const reasoning = extractReasoning(msg);

    if (typeof msg.refusal === 'string' && msg.refusal.length > 0) {
      return {
        text: msg.refusal,
        reasonedOnly: false,
        finishReason,
        nativeFinishReason: nativeFinishReason ?? undefined,
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
        nativeFinishReason: nativeFinishReason ?? undefined,
        reasoning,
        usage,
      };
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

    return emptyExtracted(finishReason, nativeFinishReason ?? undefined, usage);
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
