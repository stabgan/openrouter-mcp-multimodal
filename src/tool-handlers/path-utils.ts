import { extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';

/** Strip existing extension (if any) and append a new one. */
export function replaceExtension(filePath: string, newExt: string): string {
  const current = extname(filePath);
  const base = current ? filePath.slice(0, -current.length) : filePath;
  return `${base}.${newExt}`;
}

/**
 * Write bytes atomically via a same-directory temp file and rename.
 *
 * The temp file is opened with the `wx` flag (O_CREAT | O_WRONLY | O_EXCL)
 * so the kernel refuses to follow an existing symlink at the temp path.
 * This is defence-in-depth against a local attacker who pre-plants a symlink
 * to redirect the write outside the sandbox — even though the nonce makes
 * the temp name hard to predict.
 */
export async function writeOutputFile(target: string, data: Buffer): Promise<void> {
  const nonce = randomBytes(4).toString('hex');
  const tmp = `${target}.${process.pid}.${Date.now()}.${nonce}.tmp`;
  try {
    await fs.writeFile(tmp, data, { flag: 'wx' });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
