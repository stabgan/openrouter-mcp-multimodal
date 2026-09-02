import OpenAI from 'openai';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://github.com/stabgan/openrouter-mcp-multimodal',
  'X-Title': 'openrouter-mcp-multimodal',
} as const;

/** OpenAI SDK client configured for OpenRouter chat/completions endpoints. */
export function createOpenRouterOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: { ...OPENROUTER_ATTRIBUTION_HEADERS },
  });
}

export { OPENROUTER_BASE_URL, OPENROUTER_ATTRIBUTION_HEADERS };
