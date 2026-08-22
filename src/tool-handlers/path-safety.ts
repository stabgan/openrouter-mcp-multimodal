/**
 * Output-path sandbox. Tools that write files (`generate_image`,
 * `generate_audio`, future `generate_video`) route their `save_path`
 * through `resolveSafeOutputPath` so an untrusted MCP caller cannot
 * traverse outside the configured output root.
 *
 * Root resolution order:
 *   1. `OPENROUTER_OUTPUT_DIR` env var (if set and non-empty).
 *   2. `process.cwd()`.
 *
 * Set `OPENROUTER_ALLOW_UNSAFE_PATHS=1` to disable the sandbox entirely
 * (legacy v2 behavior). This is discouraged — document the trade-off
 * where it appears in user configs.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';

/**
 * Resolve the output root directory. On Windows, `process.cwd()` can be
 * a system directory (e.g. `C:\Windows\System32`) when spawned by MCP
 * clients without a working directory override. We detect that case and
 * fall back to a writable temp directory to avoid EPERM errors.
 */
function getOutputRoot(): string {
  const override = process.env.OPENROUTER_OUTPUT_DIR;
  if (override && override.length > 0) return path.resolve(override);

  const cwd = process.cwd();

  // On Windows, avoid using system directories as the default output root.
  // Common non-writable defaults when MCP clients spawn without a cwd:
  //   C:\Windows\System32, C:\Windows, C:\Program Files\...
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
 * Resolve and validate a caller-supplied output path. Creates the parent
 * directory if needed. Returns the absolute path that is safe to write.
 *
 * Throws `UnsafeOutputPathError` when the resolved path escapes the root
 * (traversal attempt) and the sandbox is enabled.
 */
export async function resolveSafeOutputPath(savePath: string): Promise<string> {
  if (isUnsafeMode()) {
    const abs = path.resolve(savePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    return abs;
  }

  const root = getOutputRoot();
  const rootReal = await fs.realpath(root).catch(() => path.resolve(root));
  // Resolve relative paths against the real root; absolute paths stay as
  // given so we can check them against the root prefix below.
  const candidate = path.isAbsolute(savePath)
    ? path.resolve(savePath)
    : path.resolve(rootReal, savePath);

  // Walk up from the candidate dir to find the first component that exists
  // so we can realpath it. This lets us create new subdirectories under the
  // root while still catching symlink-based traversal.
  const withSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  const candidateDir = path.dirname(candidate);

  const existingAncestor = await findExistingAncestor(candidateDir);
  const ancestorReal = await fs.realpath(existingAncestor);

  // The realpath of the first-existing ancestor MUST be within the root.
  if (!(ancestorReal === rootReal || ancestorReal.startsWith(withSep))) {
    throw new UnsafeOutputPathError(
      `save_path resolves outside OPENROUTER_OUTPUT_DIR (${rootReal}). ` +
        `Set OPENROUTER_OUTPUT_DIR to a wider root or OPENROUTER_ALLOW_UNSAFE_PATHS=1 to disable this check.`,
    );
  }

  // Safe to create missing intermediate directories now.
  await fs.mkdir(candidateDir, { recursive: true });

  // Re-realpath the final parent in case mkdir traversed a symlink.
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

/**
 * Root-resolution for caller-supplied INPUT paths. Prefers
 * `OPENROUTER_INPUT_DIR`, then `OPENROUTER_OUTPUT_DIR`, then `process.cwd()`.
 * On Windows, applies the same system-directory detection as getOutputRoot.
 */
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

/**
 * Resolve and validate a caller-supplied INPUT path. Unlike
 * `resolveSafeOutputPath`, this never creates directories — it only
 * confirms the path lives inside the input sandbox and returns the
 * absolute path the caller can `fs.readFile` from.
 *
 * Accepts the same `OPENROUTER_ALLOW_UNSAFE_PATHS=1` legacy bypass.
 * Throws `UnsafeOutputPathError` on traversal attempts (re-used type so
 * handlers map errors uniformly to `ErrorCode.UNSAFE_PATH`).
 */
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

  // Prefer realpath for the prefix check so callers can pass paths
  // through symlinks (e.g. macOS `/var/...` → `/private/var/...`)
  // without us rejecting them. If the file doesn't exist yet, fall
  // back to a textual check on the resolved path so traversal
  // (`../escape.png`) is still rejected with the right error type
  // instead of leaking an ENOENT to the caller.
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
