import { parseBase64DataUrl } from './fetch-utils.js';
import { fetchImageWithMime, getMaxDataUrlBytes } from './image-utils.js';

/**
 * Resolve an image reference to a URL (data URL, http(s) passthrough, or
 * local file → inline data URL).
 *
 * HTTP(S) URLs are passed through unchanged — the API server fetches them.
 * Data URLs are validated and size-checked before passthrough to prevent DoS
 * via multi-GB JSON request bodies (up to 20 data URLs can be embedded in
 * `input_images` / `input_references`).
 */
export async function resolveImageUrl(ref: string): Promise<string> {
  const trimmed = ref.trim();
  if (!trimmed) throw new Error('empty image reference');

  // HTTP(S) URLs: passthrough — the API server fetches the image.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // Data URLs: validate structure and enforce the same size ceiling used by
  // fetchImage / fetchImageWithMime.  Without this guard, resolveImageUrl
  // was the only data-URL code path that skipped size validation — enabling
  // arbitrarily large payloads to be embedded in outbound API request bodies.
  if (trimmed.startsWith('data:')) {
    const parsed = parseBase64DataUrl(trimmed);
    if (!parsed) throw new Error('Invalid image data URL');
    const approxBytes = Math.ceil((parsed.base64.length * 3) / 4);
    const maxBytes = getMaxDataUrlBytes();
    if (approxBytes > maxBytes) {
      throw new Error(
        `Image data URL too large (${approxBytes} bytes, max ${maxBytes}). ` +
          'Use an HTTP URL or local file path instead.',
      );
    }
    if (approxBytes === 0) throw new Error('Image data URL has empty payload (0 bytes)');
    return trimmed;
  }

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
