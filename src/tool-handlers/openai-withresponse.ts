/** Call `openai.chat.completions.create()` and return body + raw Response headers. */
import type { ChatCompletion } from 'openai/resources/chat/completions.js';

export interface ChatCompletionWithHeaders {
  data: ChatCompletion;
  response: Response | undefined;
}

export async function awaitCompletionWithHeaders(
  call: unknown,
): Promise<ChatCompletionWithHeaders> {
  const maybeChainable = call as {
    withResponse?: () => Promise<{ data: ChatCompletion; response: Response }>;
  };

  if (typeof maybeChainable?.withResponse === 'function') {
    const { data, response } = await maybeChainable.withResponse();
    return { data, response };
  }

  const data = (await (call as Promise<ChatCompletion>)) as ChatCompletion;
  return { data, response: undefined };
}
