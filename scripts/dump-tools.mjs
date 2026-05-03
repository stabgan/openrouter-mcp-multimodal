#!/usr/bin/env node
/**
 * Dumps the exact tool schemas our server advertises via tools/list,
 * so they can be embedded in the MCPB manifest for Smithery's scoring.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const proc = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, OPENROUTER_API_KEY: 'dummy' },
});

let buf = '';
proc.stdout.on('data', (c) => { buf += c.toString(); });
proc.stderr.on('data', (c) => { process.stderr.write(c); });

// Send initialize then list_tools
const send = (obj) => proc.stdin.write(JSON.stringify(obj) + '\n');

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'dump-tools', version: '0.0.0' }
}});

// Wait briefly, then request tools/list
await new Promise(r => setTimeout(r, 500));
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

// Wait for the response
await new Promise(r => setTimeout(r, 1500));

proc.kill();
await once(proc, 'close');

const lines = buf.split('\n').filter(l => l.trim());
for (const line of lines) {
  try {
    const msg = JSON.parse(line);
    if (msg.id === 2 && msg.result?.tools) {
      console.log(JSON.stringify(msg.result.tools, null, 2));
      process.exit(0);
    }
  } catch { /* keep going */ }
}
console.error('No tools/list response found in:', buf);
process.exit(1);
