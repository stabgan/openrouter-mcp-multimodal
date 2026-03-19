import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

export interface ChatCompletionToolRequest {
  model?: string;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  max_tokens?: number;
}

export async function handleChatCompletion(
  request: { params: { arguments: ChatCompletionToolRequest } },
  openai: OpenAI,
  defaultModel?: string,
) {
  const { messages, model, temperature, max_tokens } = request.params.arguments;

  if (!messages?.length) {
    return { content: [{ type: 'text', text: 'Messages array cannot be empty.' }], isError: true };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: model || defaultModel || 'nvidia/nemotron-nano-12b-v2-vl:free',
      messages,
      temperature: temperature ?? 1,
      ...(max_tokens && { max_tokens }),
    });

    return { content: [{ type: 'text', text: completion.choices[0].message.content || '' }] };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `API error: ${msg}` }], isError: true };
  }
}
