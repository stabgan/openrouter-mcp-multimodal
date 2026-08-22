import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { ErrorCode, toolErrorFrom, type ToolErrorResult } from '../errors.js';

/**
 * Path sandboxes for MCP caller-supplied input/output paths.
 * Set `OPENROUTER_ALLOW_UNSAFE_PATHS=1` to disable (legacy v2 behavior).
 *
 * Output paths: walk to the first existing ancestor, realpath it, and reject
 * escapes before mkdir. Re-realpath the parent after mkdir to catch symlink traversal.
 *
 * Input paths: realpath when the file exists; otherwise reject via resolved prefix
 * so `../escape` fails without leaking ENOENT.
 */

/** Output root: OPENROUTER_OUTPUT_DIR, or cwd (with Windows system-dir fallback). */
function getOutputRoot(): string {
  const override = process.env.OPENROUTER_OUTPUT_DIR;
  if (override && override.length > 0) return path.resolve(override);

  const cwd = process.cwd();

  if (process.platform === 'win32') {
    const cwdLower = cwd.toLowerCase().replace(/\\/g, '/');
    if (
      cwdLower.startsWith('c:/windows') ||
      cwdLower.startsWith('c:/program files') ||
      cwdLower.startsWith('c:/program files (x86)')
    ) {
      const fallback = path.join(os.homedir(), 'openrouter-mcp-output');
      return fallback;
    }
  }

  return cwd;
}

function isUnsafeMode(): boolean {
  const v = process.env.OPENROUTER_ALLOW_UNSAFE_PATHS;
  return v === '1' || v?.toLowerCase() === 'true';
}

export class UnsafeOutputPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeOutputPathError';
  }
}

/**
 * Resolve and validate a caller-supplied output path.
 * Throws `UnsafeOutputPathError` on traversal attempts.
 */
export async function resolveSafeOutputPath(savePath: string): Promise<string> {
  if (isUnsafeMode()) {
    const abs = path.resolve(savePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    return abs;
  }

  const root = getOutputRoot();
  const rootReal = await fs.realpath(root).catch(() => path.resolve(root));
  const candidate = path.isAbsolute(savePath)
    ? path.resolve(savePath)
    : path.resolve(rootReal, savePath);

  const withSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  const candidateDir = path.dirname(candidate);

  const existingAncestor = await findExistingAncestor(candidateDir);
  const ancestorReal = await fs.realpath(existingAncestor);

  if (!(ancestorReal === rootReal || ancestorReal.startsWith(withSep))) {
    throw new UnsafeOutputPathError(
      `save_path resolves outside OPENROUTER_OUTPUT_DIR (${rootReal}). ` +
        `Set OPENROUTER_OUTPUT_DIR to a wider root or OPENROUTER_ALLOW_UNSAFE_PATHS=1 to disable this check.`,
    );
  }

  await fs.mkdir(candidateDir, { recursive: true });

  const parentReal = await fs.realpath(candidateDir);
  if (!(parentReal === rootReal || parentReal.startsWith(withSep))) {
    throw new UnsafeOutputPathError(
      `save_path escapes OPENROUTER_OUTPUT_DIR via symlink (${rootReal}).`,
    );
  }

  return path.join(parentReal, path.basename(candidate));
}

async function findExistingAncestor(dir: string): Promise<string> {
  let current = dir;
  for (;;) {
    try {
      await fs.access(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current; // reached root
      current = parent;
    }
  }
}

/** Input root: OPENROUTER_INPUT_DIR, then OPENROUTER_OUTPUT_DIR, then cwd. */
function getInputRoot(): string {
  const inputDir = process.env.OPENROUTER_INPUT_DIR;
  if (inputDir && inputDir.length > 0) return path.resolve(inputDir);
  const outputDir = process.env.OPENROUTER_OUTPUT_DIR;
  if (outputDir && outputDir.length > 0) return path.resolve(outputDir);

  const cwd = process.cwd();
  if (process.platform === 'win32') {
    const cwdLower = cwd.toLowerCase().replace(/\\/g, '/');
    if (
      cwdLower.startsWith('c:/windows') ||
      cwdLower.startsWith('c:/program files') ||
      cwdLower.startsWith('c:/program files (x86)')
    ) {
      return path.join(os.homedir(), 'openrouter-mcp-output');
    }
  }
  return cwd;
}

/** Resolve and validate a caller-supplied input path (read-only, no mkdir). */
export async function resolveSafeInputPath(inputPath: string): Promise<string> {
  if (isUnsafeMode()) {
    return path.resolve(inputPath);
  }

  const root = getInputRoot();
  const rootReal = await fs.realpath(root).catch(() => path.resolve(root));
  const withSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;

  const abs = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(rootReal, inputPath);

  let canonical: string;
  try {
    canonical = await fs.realpath(abs);
  } catch {
    canonical = abs;
  }

  if (!(canonical === rootReal || canonical.startsWith(withSep))) {
    throw new UnsafeOutputPathError(
      `input path resolves outside OPENROUTER_INPUT_DIR (${rootReal}): ${inputPath}`,
    );
  }

  return abs;
}

export type OptionalOutputPath = { path: string | null };

export function isToolErrorResult(
  result: OptionalOutputPath | ToolErrorResult,
): result is ToolErrorResult {
  return 'isError' in result;
}

/** Resolve optional save_path; returns a tool error result on sandbox violation. */
export async function resolveOptionalOutputPath(
  savePath: string | undefined,
): Promise<OptionalOutputPath | ToolErrorResult> {
  if (!savePath) return { path: null };
  try {
    return { path: await resolveSafeOutputPath(savePath) };
  } catch (err) {
    if (err instanceof UnsafeOutputPathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
    return toolErrorFrom(ErrorCode.INTERNAL, err);
  }
}
