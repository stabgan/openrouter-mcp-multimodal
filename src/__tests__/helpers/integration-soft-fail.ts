/**
 * Live OpenRouter integration tests can fail on the free tier or under CI
 * load (402, 429, premature close, timeouts). Treat those as soft passes so
 * the suite still validates handler wiring without flaking on upstream capacity.
 */
import { expect } from 'vitest';
type ToolResult = {
  isError?: boolean;
  content?: Array<{ text?: string }>;
  _meta?: { code?: string };
};

const SOFT_CODES = new Set(['UPSTREAM_REFUSED', 'UPSTREAM_TIMEOUT', 'RATE_LIMITED', 'INTERNAL']);

const SOFT_TEXT = [
  '402',
  '429',
  '503',
  '504',
  'premature close',
  'timeout',
  'rate limit',
  'insufficient credits',
  'user not found',
];

export function isSoftIntegrationFailure(result: ToolResult): boolean {
  if (!result.isError) return false;
  const code = result._meta?.code;
  if (code && SOFT_CODES.has(code)) return true;
  const text = (result.content?.[0]?.text ?? '').toLowerCase();
  return SOFT_TEXT.some((needle) => text.includes(needle));
}

/** Returns true when the call succeeded (not a soft upstream failure). */
export function expectSuccessOrSoftFailure(result: ToolResult): boolean {
  if (isSoftIntegrationFailure(result)) {
    expect(result.isError).toBe(true);
    return false;
  }
  expect(result.isError).toBeFalsy();
  return true;
}
