import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  resolveSafeOutputPath,
  resolveSafeInputPath,
  UnsafeOutputPathError,
} from '../tool-handlers/path-safety.js';

describe('resolveSafeOutputPath', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'mcp-path-safety-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', root);
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('resolves a relative filename under the root', async () => {
    const out = await resolveSafeOutputPath('output.png');
    expect(out).toBe(path.join(await fs.realpath(root), 'output.png'));
  });

  it('resolves nested relative paths and creates parent dirs', async () => {
    const out = await resolveSafeOutputPath('sub/dir/out.wav');
    const parent = path.dirname(out);
    const stat = await fs.stat(parent);
    expect(stat.isDirectory()).toBe(true);
  });

  it('accepts absolute paths that land inside the root', async () => {
    const abs = path.join(root, 'inside.mp3');
    const out = await resolveSafeOutputPath(abs);
    expect(out).toBe(path.join(await fs.realpath(root), 'inside.mp3'));
  });

  it('rejects traversal attempts (..) that escape the root', async () => {
    await expect(resolveSafeOutputPath('../escape.png')).rejects.toBeInstanceOf(
      UnsafeOutputPathError,
    );
    await expect(resolveSafeOutputPath('../../../etc/passwd')).rejects.toBeInstanceOf(
      UnsafeOutputPathError,
    );
  });

  it('rejects absolute paths outside the root', async () => {
    await expect(resolveSafeOutputPath('/etc/outside.png')).rejects.toBeInstanceOf(
      UnsafeOutputPathError,
    );
  });

  it('bypasses the sandbox when OPENROUTER_ALLOW_UNSAFE_PATHS=1', async () => {
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '1');
    const unsafePath = path.join(tmpdir(), `mcp-unsafe-${Date.now()}.bin`);
    const out = await resolveSafeOutputPath(unsafePath);
    expect(out).toBe(path.resolve(unsafePath));
    await fs.rm(path.dirname(unsafePath)).catch(() => undefined);
  });
});

describe('resolveSafeInputPath', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'mcp-input-safe-'));
    vi.stubEnv('OPENROUTER_INPUT_DIR', root);
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('accepts a relative path under the root', async () => {
    await fs.writeFile(path.join(root, 'frame.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const resolved = await resolveSafeInputPath('frame.png');
    expect(resolved.endsWith(path.sep + 'frame.png')).toBe(true);
  });

  it('accepts an absolute path under the root', async () => {
    const abs = path.join(root, 'inside.jpg');
    await fs.writeFile(abs, Buffer.from([0xff, 0xd8]));
    const resolved = await resolveSafeInputPath(abs);
    expect(resolved).toBe(abs);
  });

  it('rejects traversal (../escape)', async () => {
    await expect(resolveSafeInputPath('../escape.png')).rejects.toBeInstanceOf(
      UnsafeOutputPathError,
    );
  });

  it('rejects absolute paths outside the root (/etc/passwd)', async () => {
    await expect(resolveSafeInputPath('/etc/passwd')).rejects.toBeInstanceOf(UnsafeOutputPathError);
  });

  it('falls back to OPENROUTER_OUTPUT_DIR when OPENROUTER_INPUT_DIR is unset', async () => {
    vi.stubEnv('OPENROUTER_INPUT_DIR', '');
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', root);
    const abs = path.join(root, 'fallback.webp');
    await fs.writeFile(abs, Buffer.alloc(4));
    await expect(resolveSafeInputPath('fallback.webp')).resolves.toContain('fallback.webp');
  });

  it('bypasses the sandbox when OPENROUTER_ALLOW_UNSAFE_PATHS=1', async () => {
    vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '1');
    const resolved = await resolveSafeInputPath('/etc/hosts');
    expect(resolved).toBe('/etc/hosts');
  });
});
