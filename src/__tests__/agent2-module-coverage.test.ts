/**
 * Agent 2 — Test coverage for previously untested modules.
 *
 * Targets (confirmed zero or minimal test coverage via grep):
 *
 * tool-icons.ts:
 *  1. TOOL_ICONS keys match TOOL_NAMES exactly (icon ↔ tool sync)
 *  2. Each TOOL_ICONS entry is a non-empty array with { src, mimeType, sizes }
 *  3. Each icon src starts with the SVG data URI prefix
 *  4. SERVER_ICON has the correct shape and content
 *  5. No extra keys in TOOL_ICONS beyond TOOL_NAMES
 *
 * openrouter-openai-client.ts:
 *  6. createOpenRouterOpenAIClient returns an OpenAI instance
 *  7. The client uses the correct base URL (openrouter.ai)
 *  8. OPENROUTER_BASE_URL and OPENROUTER_ATTRIBUTION_HEADERS are exported
 *  9. Attribution headers include HTTP-Referer and X-Title
 *
 * tts-defaults.ts:
 * 10. DEFAULT_TTS_MODEL is a non-empty string
 * 11. DEFAULT_TTS_VOICE is a non-empty string
 * 12. DEFAULT_TTS_RESPONSE_FORMAT is a valid audio format
 *
 * embed_text — additional structuredContent integrity:
 * 13. structuredContent.embeddings preserves all fields from API
 * 14. Summary text for multi-model scenarios
 *
 * decide — response formatting completeness:
 * 15. Score answer where score array has single element (length > 0 but only one)
 * 16. Choice answer with Infinity probability value (filtered by isFinite)
 * 17. noul with -0 (negative zero) — still < 0.5, should be NO
 */
import { describe, it, expect, vi } from 'vitest';
import { TOOL_NAMES } from '../tool-descriptions.js';
import { TOOL_ICONS, SERVER_ICON } from '../tool-icons.js';
import type { ToolIcon } from '../tool-icons.js';
import {
  createOpenRouterOpenAIClient,
  OPENROUTER_BASE_URL,
  OPENROUTER_ATTRIBUTION_HEADERS,
} from '../openrouter-openai-client.js';
import {
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE,
  DEFAULT_TTS_RESPONSE_FORMAT,
} from '../tts-defaults.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

function mockEmbedClient(response: unknown) {
  const createEmbeddings = vi.fn().mockResolvedValue(response);
  return { createEmbeddings } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  const submitDecision = vi.fn().mockResolvedValue(response);
  return { submitDecision } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

function noulQ(instructions = 'Is the sky blue?') {
  return {
    type: 'noul' as const,
    instructions,
    criteria: { yes: 'Yes', no: 'No' },
  };
}

function choiceQ(instructions = 'Pick color') {
  return {
    type: 'choice' as const,
    instructions,
    criteria: { red: 'Red', blue: 'Blue', green: 'Green' },
  };
}

function scoreQ(instructions = 'Rate quality') {
  return {
    type: 'score' as const,
    instructions,
    criteria: ['poor', 'fair', 'good', 'excellent'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1–5. tool-icons.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('TOOL_ICONS — icon/tool synchronization', () => {
  it('has an icon entry for every tool in TOOL_NAMES', () => {
    for (const name of TOOL_NAMES) {
      expect(TOOL_ICONS).toHaveProperty(name);
    }
  });

  it('has no extra keys beyond TOOL_NAMES', () => {
    const iconKeys = Object.keys(TOOL_ICONS).sort();
    const toolNames = [...TOOL_NAMES].sort();
    expect(iconKeys).toEqual(toolNames);
  });

  it('every icon entry is a non-empty array', () => {
    for (const [, icons] of Object.entries(TOOL_ICONS)) {
      expect(Array.isArray(icons)).toBe(true);
      expect(icons.length).toBeGreaterThan(0);
    }
  });

  it('every icon entry has the correct shape { src, mimeType, sizes }', () => {
    for (const [, icons] of Object.entries(TOOL_ICONS)) {
      for (const entry of icons as ToolIcon) {
        expect(typeof entry.src).toBe('string');
        expect(entry.mimeType).toBe('image/svg+xml');
        expect(Array.isArray(entry.sizes)).toBe(true);
        expect(entry.sizes).toContain('24x24');
      }
    }
  });

  it('every icon src starts with the SVG data URI prefix', () => {
    const SVG_PREFIX = 'data:image/svg+xml,';
    for (const icons of Object.values(TOOL_ICONS)) {
      for (const entry of icons as ToolIcon) {
        expect(entry.src.startsWith(SVG_PREFIX)).toBe(true);
      }
    }
  });

  it('icon count matches TOOL_NAMES count (21 tools)', () => {
    expect(Object.keys(TOOL_ICONS).length).toBe(TOOL_NAMES.length);
    expect(TOOL_NAMES.length).toBe(21);
  });
});

describe('SERVER_ICON — server-level icon', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(SERVER_ICON)).toBe(true);
    expect(SERVER_ICON.length).toBeGreaterThan(0);
  });

  it('has the correct shape { src, mimeType, sizes }', () => {
    const entry = SERVER_ICON[0];
    expect(typeof entry.src).toBe('string');
    expect(entry.mimeType).toBe('image/svg+xml');
    expect(Array.isArray(entry.sizes)).toBe(true);
  });

  it('server icon uses 48x48 size', () => {
    expect(SERVER_ICON[0].sizes).toContain('48x48');
  });

  it('server icon src starts with SVG data URI prefix', () => {
    expect(SERVER_ICON[0].src.startsWith('data:image/svg+xml,')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6–9. openrouter-openai-client.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('createOpenRouterOpenAIClient — factory function', () => {
  it('returns an object with chat.completions (OpenAI-compatible shape)', () => {
    const client = createOpenRouterOpenAIClient('test-key');
    expect(client).toBeDefined();
    expect(client.chat).toBeDefined();
    expect(client.chat.completions).toBeDefined();
    expect(typeof client.chat.completions.create).toBe('function');
  });

  it('configures the client with the OpenRouter base URL', () => {
    const client = createOpenRouterOpenAIClient('sk-test-123');
    expect(client.baseURL).toBe('https://openrouter.ai/api/v1');
  });
});

describe('OPENROUTER_BASE_URL — exported constant', () => {
  it('points to OpenRouter API v1', () => {
    expect(OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
  });
});

describe('OPENROUTER_ATTRIBUTION_HEADERS — exported constant', () => {
  it('contains HTTP-Referer pointing to the GitHub repo', () => {
    expect(OPENROUTER_ATTRIBUTION_HEADERS['HTTP-Referer']).toContain('github.com');
    expect(OPENROUTER_ATTRIBUTION_HEADERS['HTTP-Referer']).toContain('openrouter-mcp-multimodal');
  });

  it('contains X-Title identifying the project', () => {
    expect(OPENROUTER_ATTRIBUTION_HEADERS['X-Title']).toBe('openrouter-mcp-multimodal');
  });

  it('has exactly two entries', () => {
    expect(Object.keys(OPENROUTER_ATTRIBUTION_HEADERS)).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10–12. tts-defaults.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('TTS defaults — exported constants', () => {
  it('DEFAULT_TTS_MODEL is a non-empty string with org/model format', () => {
    expect(typeof DEFAULT_TTS_MODEL).toBe('string');
    expect(DEFAULT_TTS_MODEL.length).toBeGreaterThan(0);
    expect(DEFAULT_TTS_MODEL).toContain('/');
  });

  it('DEFAULT_TTS_VOICE is a non-empty string', () => {
    expect(typeof DEFAULT_TTS_VOICE).toBe('string');
    expect(DEFAULT_TTS_VOICE.length).toBeGreaterThan(0);
  });

  it('DEFAULT_TTS_RESPONSE_FORMAT is a recognized audio format', () => {
    const validFormats = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'opus', 'pcm'];
    expect(validFormats).toContain(DEFAULT_TTS_RESPONSE_FORMAT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13–14. embed_text — structuredContent integrity
// ═══════════════════════════════════════════════════════════════════════════

describe('handleEmbedText — structuredContent field mapping', () => {
  it('maps index and embedding from every element in data array', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2], extra_field: 'ignored' },
        { index: 1, embedding: [0.3, 0.4], extra_field: 'ignored' },
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as SuccessResult;

    const embeddings = r.structuredContent.embeddings as Array<{
      index: number;
      embedding: number[];
    }>;
    expect(embeddings).toHaveLength(2);
    // Only index and embedding should be mapped — extra_field should be stripped
    expect(Object.keys(embeddings[0])).toEqual(['index', 'embedding']);
    expect(Object.keys(embeddings[1])).toEqual(['index', 'embedding']);
  });

  it('summary includes embedding count and dimension count in text', async () => {
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3, 0.4, 0.5] },
        { index: 1, embedding: [0.6, 0.7, 0.8, 0.9, 1.0] },
        { index: 2, embedding: [0.2, 0.3, 0.4, 0.5, 0.6] },
      ],
      model: 'cohere/embed-v4',
    });
    const r = (await handleEmbedText(
      embedReq({ texts: ['x', 'y', 'z'] }),
      client,
    )) as SuccessResult;

    expect(r.content[0].text).toContain('3 embedding(s)');
    expect(r.content[0].text).toContain('5 dimensions');
    expect(r.content[0].text).toContain('cohere/embed-v4');
  });

  it('dimensions in _meta matches first embedding length even when others differ', async () => {
    // Defensive: if API returns ragged embeddings (unlikely but possible)
    const client = mockEmbedClient({
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: [0.3, 0.4, 0.5] }, // different length
      ],
      model: 'test/model',
    });
    const r = (await handleEmbedText(embedReq({ texts: ['a', 'b'] }), client)) as SuccessResult;

    // Dimensions reported from first embedding
    expect(r._meta.dimensions).toBe(2);
    expect(r.structuredContent.dimensions).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15–17. decide — response formatting edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('handleDecide — score response with single element', () => {
  it('handles score array with exactly one element', async () => {
    // score.length > 0 is true, loop runs once, maxIdx=0
    const client = mockDecideClient({
      answers: { q1: { type: 'score', score: [0.95] } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: scoreQ() } }),
      client,
    )) as SuccessResult;

    expect(r.content[0].text).toContain('level 1/1');
    expect(r.content[0].text).toContain('95.0%');
  });
});

describe('handleDecide — choice with Infinity probability', () => {
  it('filters out Infinity values from choice probabilities', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: Infinity, b: 0.6, c: -Infinity } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as SuccessResult;

    // Infinity is not finite → filtered out, only b=0.6 remains
    expect(r.content[0].text).toContain('b');
    expect(r.content[0].text).toContain('60.0%');
  });

  it('handles choice where all values are Infinity', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'choice', choice: { a: Infinity, b: -Infinity } },
      },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: choiceQ() } }),
      client,
    )) as SuccessResult;

    // All filtered → best is undefined → "?" fallback
    expect(r.content[0].text).toContain('?');
    expect(r.content[0].text).toContain('0.0%');
  });
});

describe('handleDecide — noul with negative zero', () => {
  it('treats -0 as less than 0.5 (NO)', async () => {
    const client = mockDecideClient({
      answers: { q1: { type: 'noul', noul: -0 } },
    });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ() } }),
      client,
    )) as SuccessResult;

    // -0 >= 0.5 is false → NO
    expect(r.content[0].text).toContain('NO');
    expect(r.content[0].text).toContain('0.0%');
  });
});

describe('handleDecide — mixed valid and malformed answers', () => {
  it('produces summary lines only for well-formed answers', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.8 },
        q2: 42, // number — skipped
        q3: { type: 'choice', choice: { a: 0.7, b: 0.3 } },
        q4: null, // null — skipped
        q5: { type: 'score', score: [0.1, 0.9] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: noulQ(),
          q2: noulQ(),
          q3: choiceQ(),
          q4: noulQ(),
          q5: scoreQ(),
        },
      }),
      client,
    )) as SuccessResult;

    const text = r.content[0].text;
    const lines = text.split('\n').filter((l: string) => l.trim());
    // q1, q3, q5 produce lines; q2 (number) and q4 (null) are skipped
    expect(lines.length).toBe(3);
    expect(text).toContain('q1');
    expect(text).toContain('q3');
    expect(text).toContain('q5');
    expect(text).not.toContain('q2');
    expect(text).not.toContain('q4');
  });
});

describe('handleDecide — structuredContent sanitizes upstream answers', () => {
  it('strips malformed answer entries from structuredContent', async () => {
    const answers = {
      q1: { type: 'noul', noul: 0.5 },
      q2: null,
    };
    const client = mockDecideClient({ answers });
    const r = (await handleDecide(
      decideReq({ questions: { q1: noulQ(), q2: noulQ() } }),
      client,
    )) as SuccessResult;

    // structuredContent filters out null/malformed entries for safety
    expect(r.structuredContent.answers).toEqual({
      q1: { type: 'noul', noul: 0.5 },
    });
  });
});
