import { describe, it, expect } from 'vitest';
import {
  TOOL_DESCRIPTIONS,
  TOOL_NAMES,
  REQUIRED_DESCRIPTION_SECTIONS,
  buildToolDescription,
} from '../tool-descriptions.js';
import {
  TOOL_DEFINITIONS,
  TOOL_DEFINITION_NAMES,
  TOOLS_WITH_SAVE_PATH,
  SAVE_PATH_PROPERTY,
  IMAGE_ASPECT_RATIOS,
  IMAGE_SIZES,
  IMAGE_DEDICATED_RESOLUTIONS,
  IMAGE_DEDICATED_QUALITIES,
  IMAGE_OUTPUT_FORMATS,
  GENERATE_AUDIO_FORMATS,
  TTS_RESPONSE_FORMATS,
  STT_RESPONSE_FORMATS,
} from '../tool-definitions.js';
import { SUPPORTED_VIDEO_FORMATS } from '../tool-handlers/video-utils.js';

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema & { enum?: readonly string[] }>;
  enum?: readonly string[];
  description?: string;
  minimum?: number;
};

function getTool(name: string) {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

function getInputProperty(toolName: string, prop: string): JsonSchema {
  const schema = getTool(toolName).inputSchema as JsonSchema;
  const properties = schema.properties ?? {};
  const field = properties[prop];
  if (!field) throw new Error(`${toolName}.${prop} missing from inputSchema`);
  return field;
}

function expectEnum(toolName: string, prop: string, expected: readonly string[]) {
  const field = getInputProperty(toolName, prop);
  expect(field.enum, `${toolName}.${prop} enum`).toEqual([...expected]);
}

describe('tool catalog contract', () => {
  it('defines exactly 19 tools with matching names in definitions and descriptions', () => {
    expect(TOOL_NAMES).toHaveLength(19);
    expect(TOOL_DEFINITION_NAMES).toHaveLength(19);
    expect(new Set(TOOL_DEFINITION_NAMES)).toEqual(new Set(TOOL_NAMES));
    for (const name of TOOL_NAMES) {
      expect(TOOL_DESCRIPTIONS[name]).toBeTruthy();
      expect(getTool(name).description).toBe(TOOL_DESCRIPTIONS[name]);
    }
  });

  it('every tool has non-empty description and honest annotations', () => {
    for (const name of TOOL_NAMES) {
      const tool = getTool(name);
      expect(typeof tool.description).toBe('string');
      expect((tool.description as string).length).toBeGreaterThan(100);

      const annotations = tool.annotations as Record<string, unknown>;
      expect(annotations.title).toBeTruthy();
      expect(typeof annotations.readOnlyHint).toBe('boolean');
      expect(typeof annotations.destructiveHint).toBe('boolean');
      expect(typeof annotations.idempotentHint).toBe('boolean');
      expect(typeof annotations.openWorldHint).toBe('boolean');
    }
  });

  it('read-only tools are marked readOnlyHint: true', () => {
    const readOnlyTools = [
      'get_chat_completion_status',
      'analyze_image',
      'analyze_audio',
      'analyze_video',
      'search_models',
      'get_model_info',
      'validate_model',
      'speech_to_text',
      'get_video_status',
      'rerank_documents',
      'health_check',
    ] as const;
    for (const name of readOnlyTools) {
      expect((getTool(name).annotations as { readOnlyHint: boolean }).readOnlyHint).toBe(true);
    }
  });
});

describe('save_path schema contract', () => {
  it('only save_path-capable tools expose save_path', () => {
    for (const name of TOOL_NAMES) {
      const schema = getTool(name).inputSchema as JsonSchema;
      const hasSavePath = Boolean(schema.properties?.save_path);
      if (TOOLS_WITH_SAVE_PATH.includes(name as (typeof TOOLS_WITH_SAVE_PATH)[number])) {
        expect(hasSavePath, `${name} should accept save_path`).toBe(true);
      } else {
        expect(hasSavePath, `${name} should not accept save_path`).toBe(false);
      }
    }
  });

  it('every save_path property includes the shared binary-result policy text', () => {
    const requiredFragments = [
      'OPENROUTER_OUTPUT_DIR',
      '_meta.save_path',
      'OPENROUTER_IMAGE_INLINE_MAX_BYTES',
      'OPENROUTER_AUDIO_INLINE_MAX_BYTES',
      'OPENROUTER_VIDEO_INLINE_MAX_BYTES',
      'OPENROUTER_INLINE_MAX_BYTES',
      '1 MiB',
      '10 MiB',
    ];
    for (const name of TOOLS_WITH_SAVE_PATH) {
      const desc = getInputProperty(name, 'save_path').description ?? '';
      for (const fragment of requiredFragments) {
        expect(desc, `${name}.save_path`).toContain(fragment);
      }
      expect(desc).toContain(SAVE_PATH_PROPERTY.description);
    }
  });
});

describe('schema enum sync with handler constants', () => {
  it('generate_image aspect_ratio and image_size match handler validation sets', () => {
    expectEnum('generate_image', 'aspect_ratio', IMAGE_ASPECT_RATIOS);
    expectEnum('generate_image', 'image_size', IMAGE_SIZES);
  });

  it('generate_image_dedicated enums match handler validation sets', () => {
    expectEnum('generate_image_dedicated', 'resolution', IMAGE_DEDICATED_RESOLUTIONS);
    expectEnum('generate_image_dedicated', 'aspect_ratio', IMAGE_ASPECT_RATIOS);
    expectEnum('generate_image_dedicated', 'quality', IMAGE_DEDICATED_QUALITIES);
    expectEnum('generate_image_dedicated', 'output_format', IMAGE_OUTPUT_FORMATS);
  });

  it('generate_audio format matches handler VALID_FORMATS', () => {
    expectEnum('generate_audio', 'format', GENERATE_AUDIO_FORMATS);
  });

  it('text_to_speech response_format matches handler VALID_FORMATS', () => {
    expectEnum('text_to_speech', 'response_format', TTS_RESPONSE_FORMATS);
  });

  it('speech_to_text response_format matches handler VALID_RESPONSE_FORMATS', () => {
    expectEnum('speech_to_text', 'response_format', STT_RESPONSE_FORMATS);
  });

  it('analyze_video description containers match SUPPORTED_VIDEO_FORMATS export', () => {
    const desc = TOOL_DESCRIPTIONS.analyze_video;
    for (const fmt of SUPPORTED_VIDEO_FORMATS) {
      expect(desc).toContain(fmt);
    }
  });
});

describe('video polling bounds match handler clamping', () => {
  it('generate_video max_wait_ms and poll_interval_ms minimums match runtime', () => {
    expect(getInputProperty('generate_video', 'max_wait_ms').minimum).toBe(100);
    expect(getInputProperty('generate_video', 'poll_interval_ms').minimum).toBe(50);
    expect(getInputProperty('generate_video_from_image', 'max_wait_ms').minimum).toBe(100);
    expect(getInputProperty('generate_video_from_image', 'poll_interval_ms').minimum).toBe(50);
  });
});

describe('tool descriptions structure', () => {
  it('every tool includes required sections for agent routing', () => {
    for (const name of TOOL_NAMES) {
      const desc = TOOL_DESCRIPTIONS[name];
      for (const section of REQUIRED_DESCRIPTION_SECTIONS) {
        expect(desc, `${name} missing ${section}`).toContain(section);
      }
    }
  });

  it('every tool has at least one good and one bad example', () => {
    for (const name of TOOL_NAMES) {
      const desc = TOOL_DESCRIPTIONS[name];
      expect(desc).toMatch(/Good examples:\n-/);
      expect(desc).toMatch(/Bad examples:\n-/);
    }
  });

  it('overlapping tools cross-reference alternatives', () => {
    expect(TOOL_DESCRIPTIONS.generate_image).toContain('generate_image_dedicated');
    expect(TOOL_DESCRIPTIONS.generate_image_dedicated).toContain('generate_image');
    expect(TOOL_DESCRIPTIONS.generate_audio).toContain('text_to_speech');
    expect(TOOL_DESCRIPTIONS.text_to_speech).toContain('generate_audio');
    expect(TOOL_DESCRIPTIONS.analyze_audio).toContain('speech_to_text');
    expect(TOOL_DESCRIPTIONS.speech_to_text).toContain('analyze_audio');
  });

  it('video tools document JOB_STILL_RUNNING resume semantics', () => {
    for (const name of [
      'generate_video',
      'generate_video_from_image',
      'get_video_status',
    ] as const) {
      expect(TOOL_DESCRIPTIONS[name]).toContain('JOB_STILL_RUNNING');
    }
  });

  it('analyze tools document UNSAFE_PATH for sandbox escapes', () => {
    for (const name of ['analyze_image', 'analyze_audio', 'analyze_video'] as const) {
      expect(TOOL_DESCRIPTIONS[name]).toContain('UNSAFE_PATH');
    }
  });

  it('buildToolDescription preserves section order', () => {
    const built = buildToolDescription({
      summary: 'Test tool.',
      useWhen: ['a'],
      notWhen: ['b'],
      goodExamples: ['g'],
      badExamples: ['bad'],
      failsWhen: ['f'],
      worksWith: ['other'],
    });
    const useIdx = built.indexOf('Use when:');
    const notIdx = built.indexOf('Do NOT use when:');
    const goodIdx = built.indexOf('Good examples:');
    const badIdx = built.indexOf('Bad examples:');
    const failIdx = built.indexOf('Fails when:');
    const worksIdx = built.indexOf('Works with:');
    expect(useIdx).toBeLessThan(notIdx);
    expect(notIdx).toBeLessThan(goodIdx);
    expect(goodIdx).toBeLessThan(badIdx);
    expect(badIdx).toBeLessThan(failIdx);
    expect(failIdx).toBeLessThan(worksIdx);
  });
});
