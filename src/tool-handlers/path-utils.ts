import { extname } from 'node:path';

/** Strip existing extension (if any) and append a new one. */
export function replaceExtension(filePath: string, newExt: string): string {
  const current = extname(filePath);
  const base = current ? filePath.slice(0, -current.length) : filePath;
  return `${base}.${newExt}`;
}
