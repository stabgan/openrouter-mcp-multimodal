import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { resolveSafeInputPath, resolveSafeOutputPath } from '../../tool-handlers/path-safety.js';

describe('mock strata: path sandbox matrix', () => {
  let inputRoot: string;
  let outputRoot: string;

  beforeEach(async () => {
    inputRoot = await fs.mkdtemp(path.join(tmpdir(), 'mock-in-'));
    outputRoot = await fs.mkdtemp(path.join(tmpdir(), 'mock-out-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', inputRoot);
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', outputRoot);
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(inputRoot, { recursive: true, force: true });
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const safeRelativeInputs = ['file.txt', 'a/b.png', 'deep/nested/x.jpg', './local.png'];
  it.each(safeRelativeInputs)('resolveSafeInputPath allows relative %s', async (rel) => {
    const full = path.join(inputRoot, rel.replace(/^\.\//, ''));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, 'x');
    const resolved = await resolveSafeInputPath(rel);
    const rootReal = await fs.realpath(inputRoot);
    const relToRoot = path.relative(rootReal, resolved);
    expect(relToRoot.startsWith('..')).toBe(false);
  });

  const unsafeInputs = [
    '/etc/passwd',
    '/tmp/outside.png',
    '../../../etc/passwd',
    '../../../../secret',
  ];
  it.each(unsafeInputs)('resolveSafeInputPath rejects %s', async (p) => {
    await expect(resolveSafeInputPath(p)).rejects.toThrow(/sandbox|unsafe|outside/i);
  });

  const safeOutputs = ['out.png', 'nested/out.mp3', 'videos/clip.mp4'];
  it.each(safeOutputs)('resolveSafeOutputPath allows %s under output root', async (rel) => {
    const resolved = await resolveSafeOutputPath(rel);
    const rootReal = await fs.realpath(outputRoot);
    const relToRoot = path.relative(rootReal, path.dirname(resolved));
    expect(relToRoot.startsWith('..')).toBe(false);
  });

  const unsafeOutputs = ['../../../tmp/evil.mp4', '/etc/cron.d/x'];
  it.each(unsafeOutputs)('resolveSafeOutputPath rejects %s', async (p) => {
    await expect(resolveSafeOutputPath(p)).rejects.toThrow(/sandbox|unsafe|outside/i);
  });
});

describe('mock strata: path traversal variants', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'mock-trav-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', root);
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  const traversalStrings = [
    '../outside.txt',
    '../../outside.txt',
    '../../../etc/passwd',
    'safe/../../outside.txt',
  ];

  it.each(traversalStrings)('input path %s escapes sandbox', async (p) => {
    await expect(resolveSafeInputPath(p)).rejects.toThrow();
  });
});
