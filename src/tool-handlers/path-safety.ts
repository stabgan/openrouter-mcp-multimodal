import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { ErrorCode, toolError, toolErrorFrom, type ToolErrorResult } from '../errors.js';

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

/**
 * Maximum length for user-supplied file paths (bytes / chars).
 *
 * Every other user-supplied string that flows into outbound API requests,
 * log entries, or error messages has a length ceiling (model: 256, prompt:
 * 100 K, instructions: 10 K, etc.).  Path parameters (`image_path`,
 * `audio_path`, `video_path`, `save_path`) across 7+ tool handlers were
 * the remaining uncapped inputs.  Without this limit a multi-megabyte path
 * string would:
 *
 *   1. Get embedded verbatim in `UnsafePathError` messages, creating
 *      multi-megabyte Error objects.
 *   2. Cause oversized string concatenation in `toolErrorFrom` before
 *      `sanitizeErrorMessage` truncates the result.
 *   3. Feed into `path.resolve()` and `fs.realpath()` for no benefit.
 *
 * 4 096 matches POSIX `PATH_MAX` on Linux and is generous for any real
 * filesystem path on any platform (macOS PATH_MAX is 1 024).
 */
const MAX_PATH_LENGTH = 4096;

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

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

/**
 * @deprecated Use `UnsafePathError` instead. Kept as a re-export alias so
 * any external consumers that referenced the old name continue to work.
 */
export { UnsafePathError as UnsafeOutputPathError };

/**
 * Resolve and validate a caller-supplied output path.
 * Throws `UnsafePathError` on traversal attempts.
 */
export async function resolveSafeOutputPath(savePath: string): Promise<string> {
  if (isUnsafeMode()) {
    const abs = path.resolve(savePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    return abs;
  }

  if (savePath.length > MAX_PATH_LENGTH) {
    throw new UnsafePathError(
      `save_path exceeds maximum length ${MAX_PATH_LENGTH} (got ${savePath.length}).`,
    );
  }

  if (pathHasNullByte(savePath)) {
    throw new UnsafePathError('save_path contains a null byte');
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
    throw new UnsafePathError(
      `save_path resolves outside OPENROUTER_OUTPUT_DIR. ` +
        `Set OPENROUTER_OUTPUT_DIR to a wider root or OPENROUTER_ALLOW_UNSAFE_PATHS=1 to disable this check.`,
    );
  }

  await fs.mkdir(candidateDir, { recursive: true });

  const parentReal = await fs.realpath(candidateDir);
  if (!isInsideRoot(parentReal, rootReal)) {
    throw new UnsafePathError(
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

  if (inputPath.length > MAX_PATH_LENGTH) {
    throw new UnsafePathError(
      `input path exceeds maximum length ${MAX_PATH_LENGTH} (got ${inputPath.length}).`,
    );
  }

  if (pathHasNullByte(inputPath)) {
    throw new UnsafePathError('input path contains a null byte');
  }

  const root = getInputRoot();
  const rootReal = await fs.realpath(root).catch(() => path.resolve(root));

  const abs = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(rootReal, inputPath);

  const existingAncestor = await findExistingAncestor(abs);
  const ancestorReal = await fs.realpath(existingAncestor);
  if (!isInsideRoot(ancestorReal, rootReal)) {
    // Truncate inputPath in the error message to prevent oversized Error
    // objects when a multi-kilobyte path reaches this code path.  The path
    // length is capped above, but defence-in-depth: downstream code
    // (toolErrorFrom → base + err.message) concatenates before truncation.
    const safePath = inputPath.length > 200 ? inputPath.slice(0, 200) + '…' : inputPath;
    throw new UnsafePathError(
      `input path resolves outside OPENROUTER_INPUT_DIR: ${safePath}. ` +
        'Set OPENROUTER_INPUT_DIR to a wider root or OPENROUTER_ALLOW_UNSAFE_PATHS=1 to disable this check.',
    );
  }

  try {
    const canonical = await fs.realpath(abs);
    if (!isInsideRoot(canonical, rootReal)) {
      const safePath = inputPath.length > 200 ? inputPath.slice(0, 200) + '…' : inputPath;
      throw new UnsafePathError(
        `input path resolves outside OPENROUTER_INPUT_DIR: ${safePath}. ` +
          'Set OPENROUTER_INPUT_DIR to a wider root or OPENROUTER_ALLOW_UNSAFE_PATHS=1 to disable this check.',
      );
    }
    return canonical;
  } catch (err) {
    if (err instanceof UnsafePathError) throw err;
    if (!isInsideRoot(abs, rootReal)) {
      const safePath = inputPath.length > 200 ? inputPath.slice(0, 200) + '…' : inputPath;
      throw new UnsafePathError(
        `input path resolves outside OPENROUTER_INPUT_DIR: ${safePath}. ` +
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
  // Reject non-string truthy values — MCP clients that ignore the JSON
  // schema can send numbers, booleans, objects, or arrays.  Without this
  // guard, non-strings are silently coerced by `path.resolve()`, producing
  // confusing file names ("42", "true", "[object Object]") or throwing an
  // unclassified TypeError from `pathHasNullByte` (`.includes()` on a
  // non-string).  In unsafe mode the coercion succeeds silently, creating
  // files with bizarre names.  Matches the explicit `typeof` checks on
  // every other user-supplied parameter across all 21 tool handlers.
  if (typeof savePath !== 'string') {
    return toolError(ErrorCode.INVALID_INPUT, 'save_path must be a string.');
  }
  try {
    return { path: await resolveSafeOutputPath(savePath) };
  } catch (err) {
    if (err instanceof UnsafePathError) return toolErrorFrom(ErrorCode.UNSAFE_PATH, err);
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
  // Resolve the candidate against rootReal (not the raw jobsDir) so the
  // isInsideRoot check below works correctly when jobsDir is reached through
  // a symlink.  This mirrors how resolveSafeOutputPath resolves relative
  // paths against rootReal.
  const jobDirCandidate = path.resolve(rootReal, jobId);

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
