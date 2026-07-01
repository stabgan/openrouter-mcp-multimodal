#!/usr/bin/env node
/**
 * End-to-end Docker smoke: `docker run -i openrouter-mcp-multimodal:4.5.2-test`
 * over stdio, list tools, run a live validate_model call, test error paths.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const { version: PKG_VERSION } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const EXPECTED_TOOLS = 14;
const IMAGE = process.env.MCP_DOCKER_IMAGE || `openrouter-mcp-multimodal:${PKG_VERSION}-test`;

const proc = spawn(
  'docker',
  ['run', '--rm', '-i', '-e', `OPENROUTER_API_KEY=${process.env.OPENROUTER_API_KEY ?? ''}`, '-e', 'OPENROUTER_LOG_LEVEL=warn', IMAGE],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);
proc.stderr.on('data', (c) => process.stderr.write(c));

let buf = '';
const pending = new Map();
let nextId = 1;
proc.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id).resolve(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* ignore */
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`✓ ${name}`);
  else {
    console.log(`✗ ${name}: ${detail}`);
    failures += 1;
  }
}

try {
  const init = await Promise.race([
    rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'docker-smoke', version: '1.0' },
    }),
    delay(20_000).then(() => ({ error: 'init timeout' })),
  ]);
  check('initialize', !init.error && init.result?.serverInfo?.version === PKG_VERSION,
    `got ${JSON.stringify(init.result?.serverInfo ?? init.error)}`);

  const list = await rpc('tools/list', {});
  const names = list.result?.tools?.map((t) => t.name) ?? [];
  check(`tools/list has ${EXPECTED_TOOLS} tools`, names.length === EXPECTED_TOOLS, `got ${names.length}`);
  check('has analyze_video', names.includes('analyze_video'), 'missing');
  check('has generate_video', names.includes('generate_video'), 'missing');
  check('has get_video_status', names.includes('get_video_status'), 'missing');

  // Live validate_model to confirm the containerized server can reach OpenRouter.
  if (process.env.OPENROUTER_API_KEY) {
    const r = await rpc('tools/call', {
      name: 'validate_model',
      arguments: { model: 'openai/gpt-4' },
    });
    const validPayload =
      r.result?.structuredContent ??
      (r.result?.content?.[0]?.text ? JSON.parse(r.result.content[0].text) : null);
    check('validate_model reaches OpenRouter from container',
      validPayload?.valid === true,
      `got ${JSON.stringify(r.result)}`);
  }

  // Error taxonomy still works inside the container.
  const bad = await rpc('tools/call', {
    name: 'chat_completion',
    arguments: { messages: [] },
  });
  check('INVALID_INPUT path works',
    bad.result?.isError && bad.result?._meta?.code === 'INVALID_INPUT',
    `got ${JSON.stringify(bad.result)}`);

  // sharp is present in the runtime image — exercise analyze_image with a tiny local file path.
  // But the container has no access to the host file system, so skip this check here.
} finally {
  proc.kill('SIGTERM');
  await delay(500);
}

console.log(failures === 0 ? '\nDocker smoke: PASS' : `\nDocker smoke: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
