import { extname } from 'node:path';
import { promises as fs } from 'node:fs';

/** Strip existing extension (if any) and append a new one. */
export function replaceExtension(filePath: string, newExt: string): string {
  const current = extname(filePath);
  const base = current ? filePath.slice(0, -current.length) : filePath;
  return `${base}.${newExt}`;
}

/** Write bytes atomically via a same-directory temp file and rename. */
export async function writeOutputFile(target: string, data: Buffer): Promise<void> {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
