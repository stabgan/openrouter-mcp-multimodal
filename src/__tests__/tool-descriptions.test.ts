import { describe, it, expect } from 'vitest';
import {
  TOOL_DESCRIPTIONS,
  TOOL_NAMES,
  REQUIRED_DESCRIPTION_SECTIONS,
  buildToolDescription,
} from '../tool-descriptions.js';

describe('tool descriptions structure', () => {
  it('defines all 14 tools', () => {
    expect(TOOL_NAMES).toHaveLength(14);
    for (const name of TOOL_NAMES) {
      expect(TOOL_DESCRIPTIONS[name]).toBeTruthy();
    }
  });

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
