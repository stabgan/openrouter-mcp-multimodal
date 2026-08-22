import { fetchImageWithMime } from './image-utils.js';

/** Resolve an image reference to a URL (data URL or http(s) passthrough). */
export async function resolveImageUrl(ref: string): Promise<string> {
  const trimmed = ref.trim();
  if (!trimmed) throw new Error('empty image reference');
  if (trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)) return trimmed;

  const { buffer, mime } = await fetchImageWithMime(trimmed);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** Resolve an image reference to base64 payload + mime (for video frame uploads). */
export async function resolveImageBase64(source: string): Promise<{ mime: string; data: string }> {
  if (!source.trim()) throw new Error('empty image source');
  const { buffer, mime } = await fetchImageWithMime(source);
  return { mime, data: buffer.toString('base64') };
}

/** OpenRouter dedicated-image API reference shape. */
export async function toOpenRouterImageReference(
  source: string,
): Promise<{ type: string; image_url: { url: string } }> {
  const url = await resolveImageUrl(source);
  return { type: 'image_url', image_url: { url } };
}
