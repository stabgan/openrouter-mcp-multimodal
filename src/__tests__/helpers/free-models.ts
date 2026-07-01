/**
 * Free OpenRouter models for integration / live tests (zero-credit accounts).
 * Override with OPENROUTER_INTEGRATION_MODEL in .env when a model is retired.
 */
export const FREE_INTEGRATION_MODEL = 'google/gemma-4-26b-a4b-it:free';

/** Vision-capable free models (subset verified for analyze_image). */
export const FREE_VISION_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
] as const;

/** Text-only free models suitable for chat_completion integration. */
export const FREE_CHAT_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-3.2-3b-instruct:free',
] as const;

export function resolveIntegrationModel(env = process.env): string {
  return env.OPENROUTER_INTEGRATION_MODEL?.trim() || FREE_INTEGRATION_MODEL;
}
