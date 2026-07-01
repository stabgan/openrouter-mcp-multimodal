import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';

export async function withInputSandbox<T>(
  prefix: string,
  fn: (root: string) => Promise<T>,
): Promise<T> {
  const root = await fs.mkdtemp(path.join(tmpdir(), prefix));
  vi.stubEnv('OPENROUTER_INPUT_DIR', root);
  vi.stubEnv('OPENROUTER_OUTPUT_DIR', '');
  vi.stubEnv('OPENROUTER_ALLOW_UNSAFE_PATHS', '');
  try {
    return await fn(root);
  } finally {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  }
}
