/**
 * Helper for calling `openai.chat.completions.create()` and getting back
 * BOTH the typed body and the raw fetch `Response` (so we can read the
 * X-OpenRouter-Cache-* headers).
 *
 * The real openai SDK returns an `APIPromise` that exposes `.withResponse()`.
 * Vitest tests typically stub `create()` to return a plain `ChatCompletion`
 * object. This helper handles both cases so tests don't need to mock the
 * chainable.
 */
import type { ChatCompletion } from 'openai/resources/chat/completions.js';

export interface ChatCompletionWithHeaders {
  data: ChatCompletion;
  response: Response | undefined;
}

export async function awaitCompletionWithHeaders(
  call: unknown,
): Promise<ChatCompletionWithHeaders> {
  // Prefer the APIPromise .withResponse() chainable, which returns
  // `{ data, response }` — but only if the object looks like an
  // APIPromise. Mocks that return plain objects get unwrapped via a
  // direct await.
  const maybeChainable = call as {
    withResponse?: () => Promise<{ data: ChatCompletion; response: Response }>;
  };

  if (typeof maybeChainable?.withResponse === 'function') {
    const { data, response } = await maybeChainable.withResponse();
    return { data, response };
  }

  // Fallback: await the value directly. Covers both test mocks
  // (which return a plain ChatCompletion via vi.fn().mockResolvedValue())
  // and any exotic SDK shape we don't recognize.
  const data = (await (call as Promise<ChatCompletion>)) as ChatCompletion;
  return { data, response: undefined };
}
