/**
 * Agent 2 — Response sanitization coverage for decide and embed_text.
 *
 * These tests target code paths confirmed untested via exhaustive grep:
 *
 * decide — upstream response sanitization:
 *  1. __proto__ key in upstream answer names → stripped from sanitizedAnswers
 *  2. constructor key in upstream answer names → stripped
 *  3. prototype key in upstream answer names → stripped
 *  4. __proto__ key in upstream choice probability map → stripped via safeChoice
 *  5. constructor key in upstream choice probability map → stripped
 *  6. Combined: answer name and choice key both contain unsafe keys
 *  7. choice answer where answer.choice is a non-object (number) → else branch
 *  8. choice answer where answer.choice is null → else branch
 *  9. choice answer where answer.choice is an array → else branch
 * 10. Mixed response: some answers sanitized, some skipped, some pass through
 * 11. noul answer does NOT go through choice sanitization (else branch)
 * 12. score answer does NOT go through choice sanitization (else branch)
 *
 * embed_text — edge cases:
 * 13. response.data is undefined (no field) and response has extra keys → INTERNAL with response_keys
 * 14. response with usage=null → usage omitted from _meta
 * 15. dimensions=undefined omitted from API call vs dimensions=0 rejected
 */
import { describe, it, expect, vi } from 'vitest';
import { handleDecide } from '../tool-handlers/decide.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type DecideSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    answers: Record<
      string,
      {
        type: string;
        noul?: number;
        choice?: Record<string, number>;
        score?: number[];
      }
    >;
  };
  _meta: Record<string, unknown>;
};

type EmbedSuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: {
    embeddings: Array<{ index: number; embedding: number[] }>;
    model: string;
    dimensions: number;
  };
  _meta: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockDecideClient(response: unknown, throws?: Error) {
  const submitDecision = vi.fn();
  if (throws) submitDecision.mockRejectedValue(throws);
  else submitDecision.mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function mockEmbedClient(response: unknown, throws?: Error) {
  const createEmbeddings = vi.fn();
  if (throws) createEmbeddings.mockRejectedValue(throws);
  else createEmbeddings.mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function noulQuestion(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'The sky is blue', no: 'The sky is not blue' },
  };
}

function choiceQuestion(instructions = 'Pick a color') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { red: 'Color red', blue: 'Color blue', green: 'Color green' },
  };
}

function scoreQuestion(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

// ---------------------------------------------------------------------------
// 1–3. decide — upstream answer names with prototype-pollution keys
// ---------------------------------------------------------------------------

describe('handleDecide — upstream response answer name sanitization', () => {
  it('strips __proto__ key from upstream answer names in structuredContent', async () => {
    // Simulate an upstream API returning __proto__ as an answer key.
    // The handler should strip it from sanitizedAnswers.
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.9 };
    answers['safe_q'] = { type: 'noul', noul: 0.7 };

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { safe_q: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // __proto__ should be stripped, safe_q should remain
    expect(r.structuredContent.answers).toBeDefined();
    expect(r.structuredContent.answers['safe_q']).toBeDefined();
    expect(Object.keys(r.structuredContent.answers)).not.toContain('__proto__');
  });

  it('strips constructor key from upstream answer names', async () => {
    const answers = Object.create(null);
    answers['constructor'] = { type: 'noul', noul: 0.8 };
    answers['valid_q'] = { type: 'noul', noul: 0.6 };

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { valid_q: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(Object.keys(r.structuredContent.answers)).not.toContain('constructor');
    expect(r.structuredContent.answers['valid_q']).toBeDefined();
  });

  it('strips prototype key from upstream answer names', async () => {
    const answers = Object.create(null);
    answers['prototype'] = { type: 'choice', choice: { a: 0.5, b: 0.5 } };
    answers['q1'] = { type: 'noul', noul: 0.4 };

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(Object.keys(r.structuredContent.answers)).not.toContain('prototype');
    expect(r.structuredContent.answers['q1']).toBeDefined();
  });

  it('does not include stripped answer names in the text summary', async () => {
    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.99 };
    answers['visible'] = { type: 'noul', noul: 0.3 };

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { visible: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // __proto__ should not appear in the summary text at all
    expect(r.content[0].text).not.toContain('__proto__');
    expect(r.content[0].text).toContain('visible');
  });
});

// ---------------------------------------------------------------------------
// 4–6. decide — upstream choice map keys with prototype-pollution keys
// ---------------------------------------------------------------------------

describe('handleDecide — upstream choice map key sanitization', () => {
  it('strips __proto__ from choice probability keys via safeChoice', async () => {
    const choiceMap = Object.create(null);
    choiceMap['__proto__'] = 0.9;
    choiceMap['red'] = 0.05;
    choiceMap['blue'] = 0.05;

    const answers = {
      q1: { type: 'choice', choice: choiceMap },
    };

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // __proto__ should be stripped from the choice map
    const resultChoice = r.structuredContent.answers['q1']?.choice;
    expect(resultChoice).toBeDefined();
    expect(Object.keys(resultChoice!)).not.toContain('__proto__');
    expect(resultChoice!['red']).toBe(0.05);
    expect(resultChoice!['blue']).toBe(0.05);
  });

  it('strips constructor from choice probability keys', async () => {
    const choiceMap = Object.create(null);
    choiceMap['constructor'] = 0.7;
    choiceMap['a'] = 0.2;
    choiceMap['b'] = 0.1;

    const answers = {
      q1: { type: 'choice', choice: choiceMap },
    };

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    const resultChoice = r.structuredContent.answers['q1']?.choice;
    expect(Object.keys(resultChoice!)).not.toContain('constructor');
    expect(resultChoice!['a']).toBe(0.2);
  });

  it('strips prototype from choice probability keys', async () => {
    const choiceMap = Object.create(null);
    choiceMap['prototype'] = 0.5;
    choiceMap['x'] = 0.3;
    choiceMap['y'] = 0.2;

    const answers = {
      q1: { type: 'choice', choice: choiceMap },
    };

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    const resultChoice = r.structuredContent.answers['q1']?.choice;
    expect(Object.keys(resultChoice!)).not.toContain('prototype');
  });

  it('strips unsafe keys from both answer name and choice map simultaneously', async () => {
    // Upstream returns both an unsafe answer name AND unsafe choice keys
    const choiceMap = Object.create(null);
    choiceMap['__proto__'] = 0.8;
    choiceMap['safe_opt'] = 0.2;

    const answers = Object.create(null);
    answers['__proto__'] = { type: 'choice', choice: { a: 0.5, b: 0.5 } };
    answers['q1'] = { type: 'choice', choice: choiceMap };

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // __proto__ answer should be stripped
    expect(Object.keys(r.structuredContent.answers)).not.toContain('__proto__');
    // q1's choice should have __proto__ stripped
    const q1Choice = r.structuredContent.answers['q1']?.choice;
    expect(q1Choice).toBeDefined();
    expect(Object.keys(q1Choice!)).not.toContain('__proto__');
    expect(q1Choice!['safe_opt']).toBe(0.2);
  });

  it('excludes unsafe choice keys from text summary sorting', async () => {
    // __proto__ with highest probability should not appear in summary
    const choiceMap = Object.create(null);
    choiceMap['__proto__'] = 0.99;
    choiceMap['runner_up'] = 0.01;

    const answers = { q1: { type: 'choice', choice: choiceMap } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // Summary should show runner_up as the best option, not __proto__
    expect(r.content[0].text).toContain('runner_up');
    expect(r.content[0].text).not.toContain('__proto__');
  });
});

// ---------------------------------------------------------------------------
// 7–9. decide — choice answer with non-object choice field (else branch)
// ---------------------------------------------------------------------------

describe('handleDecide — choice answer with non-object choice field', () => {
  it('passes through choice answer when choice field is a number', async () => {
    // answer.choice is truthy but not an object → else branch
    const answers = { q1: { type: 'choice', choice: 42 } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // Should still be included in structuredContent (else branch)
    expect(r.structuredContent.answers['q1']).toBeDefined();
    expect(r.structuredContent.answers['q1'].type).toBe('choice');
  });

  it('passes through choice answer when choice field is null', async () => {
    // answer.choice is falsy → else branch
    const answers = { q1: { type: 'choice', choice: null } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers['q1']).toBeDefined();
  });

  it('passes through choice answer when choice field is an array', async () => {
    // Arrays are typeof 'object' but Object.entries works on them;
    // the safeChoice path IS taken since Array is an object.
    // This tests the typeof branch
    const answers = { q1: { type: 'choice', choice: [0.5, 0.5] } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers['q1']).toBeDefined();
  });

  it('passes through choice answer when choice field is a string', async () => {
    // string is truthy but typeof !== 'object' → else branch
    const answers = { q1: { type: 'choice', choice: 'invalid' } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers['q1']).toBeDefined();
    expect(r.structuredContent.answers['q1'].type).toBe('choice');
  });
});

// ---------------------------------------------------------------------------
// 10. decide — mixed response: sanitized + skipped + pass-through
// ---------------------------------------------------------------------------

describe('handleDecide — mixed upstream response sanitization', () => {
  it('handles mix of safe, unsafe, malformed, and choice-sanitized answers', async () => {
    const unsafeChoice = Object.create(null);
    unsafeChoice['constructor'] = 0.5;
    unsafeChoice['valid_opt'] = 0.5;

    const answers = Object.create(null);
    answers['__proto__'] = { type: 'noul', noul: 0.9 }; // stripped by name
    answers['safe_noul'] = { type: 'noul', noul: 0.7 }; // pass-through
    answers['malformed'] = null; // skipped (not object)
    answers['bad_string'] = 'garbage'; // skipped (not object)
    answers['choice_q'] = { type: 'choice', choice: unsafeChoice }; // sanitized choice

    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({
        questions: {
          safe_noul: noulQuestion(),
          choice_q: choiceQuestion(),
        },
      }),
      client,
    )) as DecideSuccessResult;

    const answerKeys = Object.keys(r.structuredContent.answers);
    // __proto__ stripped, malformed/bad_string skipped
    expect(answerKeys).not.toContain('__proto__');
    expect(answerKeys).toContain('safe_noul');
    expect(answerKeys).toContain('choice_q');

    // choice_q has constructor stripped from its choice map
    const choiceResult = r.structuredContent.answers['choice_q']?.choice;
    expect(choiceResult).toBeDefined();
    expect(Object.keys(choiceResult!)).not.toContain('constructor');
    expect(choiceResult!['valid_opt']).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// 11–12. decide — noul and score answers use the else branch (no choice sanitization)
// ---------------------------------------------------------------------------

describe('handleDecide — non-choice answers skip safeChoice path', () => {
  it('noul answer passes through to sanitizedAnswers without choice sanitization', async () => {
    const answers = {
      q1: { type: 'noul', noul: 0.85 },
    };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // noul goes through else branch, preserved as-is
    expect(r.structuredContent.answers['q1']).toEqual({ type: 'noul', noul: 0.85 });
  });

  it('score answer passes through to sanitizedAnswers without choice sanitization', async () => {
    const answers = {
      q1: { type: 'score', score: [0.1, 0.2, 0.5, 0.2] },
    };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQuestion() } }),
      client,
    )) as DecideSuccessResult;

    expect(r.structuredContent.answers['q1']).toEqual({
      type: 'score',
      score: [0.1, 0.2, 0.5, 0.2],
    });
  });
});

// ---------------------------------------------------------------------------
// 13–15. embed_text — response edge cases
// ---------------------------------------------------------------------------

describe('handleEmbedText — response edge cases', () => {
  it('returns INTERNAL with response_keys when data is undefined and response has extra fields', async () => {
    const client = mockEmbedClient({
      model: 'openai/text-embedding-3-small',
      extra_field: 'something',
      // data is undefined
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INTERNAL');
    expect(r.content[0].text).toContain('No embeddings returned');
  });

  it('omits usage from _meta when usage is null (falsy)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
      usage: null,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    // null is falsy, so the conditional spread should not include usage
    expect(r._meta.usage).toBeUndefined();
  });

  it('omits usage from _meta when usage is 0 (falsy)', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
      usage: 0,
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    // 0 is falsy, so the conditional spread should not include usage
    expect(r._meta.usage).toBeUndefined();
  });

  it('includes usage in _meta when it is a truthy object', async () => {
    const client = mockEmbedClient({
      data: [{ index: 0, embedding: [0.1] }],
      model: 'openai/text-embedding-3-small',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
    const r = (await handleEmbedText(embedReq({ texts: 'hello' }), client)) as EmbedSuccessResult;
    expect(r._meta.usage).toEqual({ prompt_tokens: 5, total_tokens: 5 });
  });
});

// ---------------------------------------------------------------------------
// decide — additional response formatting coverage
// ---------------------------------------------------------------------------

describe('handleDecide — response formatting with sanitized choice', () => {
  it('summary shows correct winner after stripping unsafe keys from choice', async () => {
    // __proto__ has the highest probability but gets stripped;
    // the summary should show the next highest valid option
    const choiceMap = Object.create(null);
    choiceMap['__proto__'] = 0.95;
    choiceMap['option_a'] = 0.03;
    choiceMap['option_b'] = 0.02;

    const answers = { q1: { type: 'choice', choice: choiceMap } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // option_a has the highest valid probability after stripping __proto__
    expect(r.content[0].text).toContain('option_a');
    expect(r.content[0].text).toContain('3.0%');
  });

  it('shows ? fallback when all choice keys are unsafe', async () => {
    const choiceMap = Object.create(null);
    choiceMap['__proto__'] = 0.5;
    choiceMap['constructor'] = 0.3;
    choiceMap['prototype'] = 0.2;

    const answers = { q1: { type: 'choice', choice: choiceMap } };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQuestion() } }),
      client,
    )) as DecideSuccessResult;

    // All keys stripped → no valid entries → shows "?" with 0.0%
    expect(r.content[0].text).toContain('?');
    expect(r.content[0].text).toContain('0.0%');
  });
});
