/**
 * decide — structured decisions via POST /api/alpha/decisions.
 *
 * Decision models (System One) return calibrated probabilities instead of
 * text. Three question types:
 *   - noul: yes/no with P(true) and P(false)
 *   - choice: pick one from N options with per-option probabilities
 *   - score: ordered rubric with per-level probabilities
 *
 * Models: typesafe/jev-1.13, upstage/solar-decide, microsoft/decision-1
 */
import type {
  OpenRouterAPIClient,
  DecisionQuestion,
  DecisionsResponse,
} from '../openrouter-api.js';
import { ErrorCode, toolError } from '../errors.js';
import { SERVER_VERSION } from '../version.js';
import { logger } from '../logger.js';
import { classifyUpstreamError } from './openrouter-errors.js';

export interface DecideRequest {
  questions: Record<string, DecisionQuestion>;
  state?: Record<string, unknown>;
  model?: string;
}

const DEFAULT_MODEL = 'typesafe/jev-1.13';
const VALID_QUESTION_TYPES = new Set(['noul', 'choice', 'score']);
const MAX_QUESTIONS = 50;
/** Maximum length for a single instructions string (characters). */
const MAX_INSTRUCTIONS_LENGTH = 10_000;
/** Maximum serialized size for the entire state object (bytes). */
const MAX_STATE_BYTES = 100_000;
/**
 * Maximum criteria entries per question (choice/noul objects). Without a cap
 * an attacker can submit 50 questions × unlimited criteria × unlimited
 * string length, causing memory exhaustion during JSON.stringify.
 */
const MAX_CRITERIA_ENTRIES = 100;
/** Maximum criteria levels for score-type questions. */
const MAX_SCORE_LEVELS = 100;
/**
 * Maximum character length for each criteria description string. Matches the
 * per-field ceiling applied to instructions — criteria values had no limit.
 */
const MAX_CRITERIA_VALUE_LENGTH = 10_000;
/**
 * Maximum character length for question name keys.  Values, instructions,
 * and criteria descriptions are all capped, but *keys* were unbounded —
 * 50 questions × unlimited-length name ≈ arbitrary memory during
 * JSON.stringify of the outbound API request.  256 chars is generous for
 * any real identifier.
 */
const MAX_QUESTION_NAME_LENGTH = 256;
/**
 * Maximum character length for criteria object keys (noul / choice types).
 * Same rationale as MAX_QUESTION_NAME_LENGTH — criteria values are capped
 * at MAX_CRITERIA_VALUE_LENGTH but keys had no limit.
 */
const MAX_CRITERIA_KEY_LENGTH = 256;
/** Keys that could cause prototype pollution when iterated with Object.entries/for-in. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function hasUnsafeKey(obj: Record<string, unknown>): string | null {
  for (const key of Object.keys(obj)) {
    if (UNSAFE_KEYS.has(key)) return key;
  }
  return null;
}

export async function handleDecide(
  request: { params: { arguments: DecideRequest } },
  apiClient: OpenRouterAPIClient,
) {
  const args = request.params.arguments ?? ({} as DecideRequest);
  const { questions, state, model } = args;

  // Validate questions
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      'questions is required and must be an object mapping names to question definitions.',
    );
  }

  const questionNames = Object.keys(questions);
  if (questionNames.length === 0) {
    return toolError(ErrorCode.INVALID_INPUT, 'questions object cannot be empty.');
  }
  if (questionNames.length > MAX_QUESTIONS) {
    return toolError(
      ErrorCode.INVALID_INPUT,
      `Too many questions: ${questionNames.length} exceeds max ${MAX_QUESTIONS}.`,
    );
  }

  // Block prototype-pollution keys in question names (matches guards in
  // logger.ts and provider-routing.ts).
  const unsafeQKey = hasUnsafeKey(questions as Record<string, unknown>);
  if (unsafeQKey) {
    return toolError(ErrorCode.INVALID_INPUT, `questions contains unsafe key "${unsafeQKey}".`);
  }

  for (const name of questionNames) {
    if (name.length > MAX_QUESTION_NAME_LENGTH) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `Question name "${name.slice(0, 40)}…" exceeds max length ${MAX_QUESTION_NAME_LENGTH} (got ${name.length}).`,
      );
    }
    const q = questions[name]!;
    if (!q || typeof q !== 'object') {
      return toolError(ErrorCode.INVALID_INPUT, `questions.${name} must be an object.`);
    }
    if (!VALID_QUESTION_TYPES.has(q.type)) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `questions.${name}.type must be one of: noul, choice, score. Got: ${String(q.type)}`,
      );
    }
    if (typeof q.instructions !== 'string' || !q.instructions.trim()) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `questions.${name}.instructions must be a non-empty string.`,
      );
    }
    if (q.instructions.length > MAX_INSTRUCTIONS_LENGTH) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `questions.${name}.instructions exceeds max length ${MAX_INSTRUCTIONS_LENGTH}.`,
      );
    }
    if (!q.criteria) {
      return toolError(ErrorCode.INVALID_INPUT, `questions.${name}.criteria is required.`);
    }
    // Validate criteria shape based on type
    if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2) {
        return toolError(
          ErrorCode.INVALID_INPUT,
          `questions.${name}.criteria must be an array of 2+ levels for score type.`,
        );
      }
      if (q.criteria.length > MAX_SCORE_LEVELS) {
        return toolError(
          ErrorCode.INVALID_INPUT,
          `questions.${name}.criteria has ${q.criteria.length} levels — max ${MAX_SCORE_LEVELS}.`,
        );
      }
      // Validate each score level is a string description within size limits.
      for (let i = 0; i < q.criteria.length; i++) {
        if (typeof q.criteria[i] !== 'string') {
          return toolError(
            ErrorCode.INVALID_INPUT,
            `questions.${name}.criteria[${i}] must be a string.`,
          );
        }
        if ((q.criteria[i] as string).length > MAX_CRITERIA_VALUE_LENGTH) {
          return toolError(
            ErrorCode.INVALID_INPUT,
            `questions.${name}.criteria[${i}] exceeds max length ${MAX_CRITERIA_VALUE_LENGTH}.`,
          );
        }
      }
    } else {
      if (
        typeof q.criteria !== 'object' ||
        Array.isArray(q.criteria) ||
        Object.keys(q.criteria).length < 2
      ) {
        return toolError(
          ErrorCode.INVALID_INPUT,
          `questions.${name}.criteria must be an object with 2+ options for ${q.type} type.`,
        );
      }
      const criteriaKeys = Object.keys(q.criteria as Record<string, unknown>);
      if (criteriaKeys.length > MAX_CRITERIA_ENTRIES) {
        return toolError(
          ErrorCode.INVALID_INPUT,
          `questions.${name}.criteria has ${criteriaKeys.length} entries — max ${MAX_CRITERIA_ENTRIES}.`,
        );
      }
      // Block prototype-pollution keys in criteria objects.
      const unsafeCKey = hasUnsafeKey(q.criteria as Record<string, unknown>);
      if (unsafeCKey) {
        return toolError(
          ErrorCode.INVALID_INPUT,
          `questions.${name}.criteria contains unsafe key "${unsafeCKey}".`,
        );
      }
      // Validate each criteria value is a string description within size limits.
      for (const [ck, cv] of Object.entries(q.criteria as Record<string, unknown>)) {
        if (ck.length > MAX_CRITERIA_KEY_LENGTH) {
          return toolError(
            ErrorCode.INVALID_INPUT,
            `questions.${name}.criteria key "${ck.slice(0, 40)}…" exceeds max length ${MAX_CRITERIA_KEY_LENGTH} (got ${ck.length}).`,
          );
        }
        if (typeof cv !== 'string') {
          return toolError(
            ErrorCode.INVALID_INPUT,
            `questions.${name}.criteria.${ck} must be a string.`,
          );
        }
        if (cv.length > MAX_CRITERIA_VALUE_LENGTH) {
          return toolError(
            ErrorCode.INVALID_INPUT,
            `questions.${name}.criteria.${ck} exceeds max length ${MAX_CRITERIA_VALUE_LENGTH}.`,
          );
        }
      }
    }
  }

  if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
    return toolError(ErrorCode.INVALID_INPUT, 'model must be a non-empty string.');
  }

  // Validate state object if provided — block prototype-pollution keys and
  // cap serialized size to prevent oversized payloads.
  if (state !== undefined) {
    if (typeof state !== 'object' || state === null || Array.isArray(state)) {
      return toolError(ErrorCode.INVALID_INPUT, 'state must be a plain object.');
    }
    const unsafeSKey = hasUnsafeKey(state as Record<string, unknown>);
    if (unsafeSKey) {
      return toolError(ErrorCode.INVALID_INPUT, `state contains unsafe key "${unsafeSKey}".`);
    }
    let stateSize: number;
    try {
      stateSize = JSON.stringify(state).length;
    } catch {
      return toolError(ErrorCode.INVALID_INPUT, 'state is not serializable.');
    }
    if (stateSize > MAX_STATE_BYTES) {
      return toolError(
        ErrorCode.INVALID_INPUT,
        `state serialized size (${stateSize} bytes) exceeds max ${MAX_STATE_BYTES}.`,
      );
    }
  }

  const effectiveModel = model?.trim() || DEFAULT_MODEL;

  logger.audit('decide.start', {
    model: effectiveModel,
    question_count: questionNames.length,
    question_types: questionNames.map((n) => questions[n]!.type),
  });

  let response: DecisionsResponse;
  try {
    response = await apiClient.submitDecision({
      model: effectiveModel,
      questions,
      state,
    });
  } catch (err) {
    return classifyUpstreamError(err, 'decide');
  }

  const answers = response.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return toolError(ErrorCode.INTERNAL, 'No answers returned from decisions API.', {
      response_keys: Object.keys(response),
    });
  }
  if (Object.keys(answers).length === 0) {
    return toolError(ErrorCode.INTERNAL, 'No answers returned from decisions API.', {
      response_keys: Object.keys(response),
    });
  }

  // Build human-readable summary
  const lines: string[] = [];
  for (const [name, answer] of Object.entries(answers)) {
    // Defensive: skip malformed answer entries that would cause TypeErrors.
    if (!answer || typeof answer !== 'object') continue;

    if (answer.type === 'noul') {
      const prob =
        typeof answer.noul === 'number' && Number.isFinite(answer.noul) ? answer.noul : 0;
      lines.push(`${name}: ${prob >= 0.5 ? 'YES' : 'NO'} (P=${(prob * 100).toFixed(1)}%)`);
    } else if (answer.type === 'choice' && answer.choice) {
      const best = Object.entries(answer.choice).sort(([, a], [, b]) => b - a)[0];
      lines.push(`${name}: ${best?.[0] ?? '?'} (P=${((best?.[1] ?? 0) * 100).toFixed(1)}%)`);
    } else if (answer.type === 'score' && Array.isArray(answer.score) && answer.score.length > 0) {
      // Use a loop instead of Math.max(...arr) to avoid stack overflow on
      // very large score arrays — the spread operator converts array
      // elements into function arguments, which is capped by the engine.
      let maxVal = -Infinity;
      let maxIdx = 0;
      for (let i = 0; i < answer.score.length; i++) {
        if (typeof answer.score[i] === 'number' && answer.score[i]! > maxVal) {
          maxVal = answer.score[i]!;
          maxIdx = i;
        }
      }
      lines.push(
        `${name}: level ${maxIdx + 1}/${answer.score.length} (P=${((answer.score[maxIdx] ?? 0) * 100).toFixed(1)}%)`,
      );
    }
  }

  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
    structuredContent: { answers },
    _meta: {
      server_version: SERVER_VERSION,
      model: effectiveModel,
      question_count: questionNames.length,
      ...(response.usage ? { usage: response.usage } : {}),
    },
  };
}
