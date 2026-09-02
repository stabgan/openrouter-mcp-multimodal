import { describe, it, expect } from 'vitest';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { MCP_PROTOCOL_VERSION } from '../version.js';

describe('version constants', () => {
  // Guards against re-hardcoding the constant, which is how it drifted from the SDK before.
  it('MCP_PROTOCOL_VERSION matches SDK LATEST_PROTOCOL_VERSION', () => {
    expect(MCP_PROTOCOL_VERSION).toBe(LATEST_PROTOCOL_VERSION);
  });
});
