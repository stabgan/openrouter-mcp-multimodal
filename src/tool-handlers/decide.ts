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

  for (const name of questionNames) {
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
    }
  }

  if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
    return toolError(ErrorCode.INVALID_INPUT, 'model must be a non-empty string.');
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
  if (!answers || Object.keys(answers).length === 0) {
    return toolError(ErrorCode.INTERNAL, 'No answers returned from decisions API.', {
      response_keys: Object.keys(response),
    });
  }

  // Build human-readable summary
  const lines: string[] = [];
  for (const [name, answer] of Object.entries(answers)) {
    if (answer.type === 'noul') {
      const prob = answer.noul ?? 0;
      lines.push(`${name}: ${prob >= 0.5 ? 'YES' : 'NO'} (P=${(prob * 100).toFixed(1)}%)`);
    } else if (answer.type === 'choice' && answer.choice) {
      const best = Object.entries(answer.choice).sort(([, a], [, b]) => b - a)[0];
      lines.push(`${name}: ${best?.[0] ?? '?'} (P=${((best?.[1] ?? 0) * 100).toFixed(1)}%)`);
    } else if (answer.type === 'score' && answer.score) {
      const maxIdx = answer.score.indexOf(Math.max(...answer.score));
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
