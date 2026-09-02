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

function pathHasNullByte(p: string): boolean {
  return p.includes('\0');
}

function withRootSep(rootReal: string): string {
  return rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
}

/** Prefix check; case-insensitive on Windows (drive letter / path casing). */
function isInsideRoot(resolved: string, rootReal: string): boolean {
  const withSep = withRootSep(rootReal);
  if (process.platform === 'win32') {
    const lower = resolved.toLowerCase();
    const rootLower = rootReal.toLowerCase();
    return lower === rootLower || lower.startsWith(withRootSep(rootLower));
  }
  return resolved === rootReal || resolved.startsWith(withSep);
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

  if (pathHasNullByte(savePath)) {
    throw new UnsafeOutputPathError('save_path contains a null byte');
  }

  const root = getOutputRoot();
  const rootReal = await fs.realpath(root).catch(() => path.resolve(root));
  const candidate = path.isAbsolute(savePath)
    ? path.resolve(savePath)
    : path.resolve(rootReal, savePath);

  const candidateDir = path.dirname(candidate);

  const existingAncestor = await findExistingAncestor(candidateDir);
  const ancestorReal = await fs.realpath(existingAncestor);

  if (!isInsideRoot(ancestorReal, rootReal)) {
    throw new UnsafeOutputPathError(
      `save_path resolves outside OPENROUTER_OUTPUT_DIR. ` +
        `Set OPENROUTER_OUTPUT_DIR to a wider root or OPENROUTER_ALLOW_UNSAFE_PATHS=1 to disable this check.`,
    );
  }

  await fs.mkdir(candidateDir, { recursive: true });

  const parentReal = await fs.realpath(candidateDir);
  if (!isInsideRoot(parentReal, rootReal)) {
    throw new UnsafeOutputPathError(
      'save_path escapes OPENROUTER_OUTPUT_DIR via symlink. ' +
        'Set OPENROUTER_OUTPUT_DIR to a wider root or OPENROUTER_ALLOW_UNSAFE_PATHS=1 to disable this check.',
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

  if (pathHasNullByte(inputPath)) {
    throw new UnsafeOutputPathError('input path contains a null byte');
  }

  const root = getInputRoot();
  const rootReal = await fs.realpath(root).catch(() => path.resolve(root));

  const abs = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(rootReal, inputPath);

  const existingAncestor = await findExistingAncestor(abs);
  const ancestorReal = await fs.realpath(existingAncestor);
  if (!isInsideRoot(ancestorReal, rootReal)) {
    throw new UnsafeOutputPathError(
      `input path resolves outside OPENROUTER_INPUT_DIR: ${inputPath}. ` +
        'Set OPENROUTER_INPUT_DIR to a wider root or OPENROUTER_ALLOW_UNSAFE_PATHS=1 to disable this check.',
    );
  }

  try {
    const canonical = await fs.realpath(abs);
    if (!isInsideRoot(canonical, rootReal)) {
      throw new UnsafeOutputPathError(
        `input path resolves outside OPENROUTER_INPUT_DIR: ${inputPath}. ` +
          'Set OPENROUTER_INPUT_DIR to a wider root or OPENROUTER_ALLOW_UNSAFE_PATHS=1 to disable this check.',
      );
    }
    return canonical;
  } catch (err) {
    if (err instanceof UnsafeOutputPathError) throw err;
    if (!isInsideRoot(abs, rootReal)) {
      throw new UnsafeOutputPathError(
        `input path resolves outside OPENROUTER_INPUT_DIR: ${inputPath}. ` +
          'Set OPENROUTER_INPUT_DIR to a wider root or OPENROUTER_ALLOW_UNSAFE_PATHS=1 to disable this check.',
      );
    }
    return abs;
  }
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

const JOB_ID_PATTERN = /^chat_[a-zA-Z0-9_-]{1,128}$/;

export function isValidJobId(jobId: string): boolean {
  if (!JOB_ID_PATTERN.test(jobId)) return false;
  if (jobId.includes('..') || jobId.includes('/') || jobId.includes('\\')) return false;
  return true;
}

/**
 * Resolve async-chat job status.json under OPENROUTER_OUTPUT_DIR/openrouter-jobs/.
 * Uses realpath when the job directory exists to block symlink escapes.
 */
export async function resolveSafeJobStatusPath(
  jobsDir: string,
  jobId: string,
): Promise<string | null> {
  if (!isValidJobId(jobId)) return null;

  const rootReal = await fs.realpath(jobsDir).catch(() => path.resolve(jobsDir));
  const jobDirCandidate = path.resolve(jobsDir, jobId);

  let jobDirReal: string;
  try {
    jobDirReal = await fs.realpath(jobDirCandidate);
  } catch {
    if (!isInsideRoot(jobDirCandidate, rootReal)) return null;
    return path.join(jobDirCandidate, 'status.json');
  }

  if (!isInsideRoot(jobDirReal, rootReal)) return null;
  return path.join(jobDirReal, 'status.json');
}
