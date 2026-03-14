import path from 'path';
import { promises as fs } from 'fs';

const MAX_DIMENSION = 800;
const JPEG_QUALITY = 80;

let sharpFn: any = null;
let loaded = false;

async function loadSharp(): Promise<any> {
  if (!loaded) {
    loaded = true;
    try {
      const mod = await import('sharp');
      sharpFn = mod.default || mod;
    } catch {
      console.error('sharp not available, images will be sent unprocessed');
    }
  }
  return sharpFn;
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  };
  return map[ext] || 'image/jpeg';
}

export async function fetchImage(source: string): Promise<Buffer> {
  if (source.startsWith('data:')) {
    const match = source.match(/^data:[^;]+;base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    return Buffer.from(match[1], 'base64');
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  return fs.readFile(source);
}

export async function optimizeImage(buffer: Buffer): Promise<string> {
  const sharp = await loadSharp();
  if (!sharp) return buffer.toString('base64');

  try {
    const meta = await sharp(buffer).metadata();
    let pipeline = sharp(buffer);

    if (meta.width && meta.height && Math.max(meta.width, meta.height) > MAX_DIMENSION) {
      const opts = meta.width > meta.height ? { width: MAX_DIMENSION } : { height: MAX_DIMENSION };
      pipeline = pipeline.resize(opts);
    }

    const out = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
    return out.toString('base64');
  } catch {
    return buffer.toString('base64');
  }
}

export async function prepareImageUrl(source: string): Promise<string> {
  if (source.startsWith('data:')) return source;

  const buffer = await fetchImage(source);
  const base64 = await optimizeImage(buffer);
  // After optimization, output is always JPEG (sharp converts). For local files without sharp, use extension.
  const mime = source.startsWith('http') ? 'image/jpeg' : getMimeType(source);
  return `data:${mime};base64,${base64}`;
}
