#!/usr/bin/env node
/**
 * End-to-end uvx smoke: run the PyPI/git Python launcher, verify MCP stdio.
 * Requires `uvx` on PATH and Node.js (npx) for the underlying npm server.
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { version: PKG_VERSION } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const EXPECTED_TOOLS = 14;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const useLocal = process.env.MCP_UVX_LOCAL === '1';
const useGit = process.env.MCP_UVX_FROM_GIT === '1';

function localNpmTarballSpec() {
  const prefix = `stabgan-openrouter-mcp-multimodal-${PKG_VERSION}.tgz`;
  const inRoot = path.join(repoRoot, prefix);
  try {
    readFileSync(inRoot);
    return inRoot;
  } catch {
    const match = readdirSync(repoRoot).find((f) => f.startsWith('stabgan-openrouter-mcp-multimodal-') && f.endsWith('.tgz'));
    if (!match) {
      throw new Error(`No npm pack tarball in ${repoRoot}; run npm pack first`);
    }
    return path.join(repoRoot, match);
  }
}

const uvxArgs = useLocal
  ? ['--no-cache', '--from', './python', 'mcp-server-openrouter-multimodal']
  : useGit
    ? [
        '--from',
        'git+https://github.com/stabgan/openrouter-mcp-multimodal#subdirectory=python',
        'mcp-server-openrouter-multimodal',
      ]
    : ['mcp-server-openrouter-multimodal'];

const npmSpecOverride = useLocal
  ? localNpmTarballSpec()
  : process.env.OPENROUTER_MCP_NPM_SPEC?.trim();

const proc = spawn('uvx', uvxArgs, {
  env: {
    ...process.env,
    OPENROUTER_LOG_LEVEL: 'warn',
    ...(npmSpecOverride ? { OPENROUTER_MCP_NPM_SPEC: npmSpecOverride } : {}),
    ...(process.env.OPENROUTER_MCP_NPM_VERSION
      ? { OPENROUTER_MCP_NPM_VERSION: process.env.OPENROUTER_MCP_NPM_VERSION }
      : {}),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
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
      clientInfo: { name: 'uvx-smoke', version: '1.0' },
    }),
    delay(30_000).then(() => ({ error: 'init timeout' })),
  ]);
  check('initialize', !init.error && init.result?.serverInfo?.version === PKG_VERSION,
    `got ${JSON.stringify(init.result?.serverInfo ?? init.error)}`);

  const list = await rpc('tools/list', {});
  const names = list.result?.tools?.map((t) => t.name) ?? [];
  check(`tools/list has ${EXPECTED_TOOLS} tools`, names.length === EXPECTED_TOOLS, `got ${names.length}`);

  if (process.env.OPENROUTER_API_KEY) {
    const r = await rpc('tools/call', {
      name: 'validate_model',
      arguments: { model: 'openai/gpt-4' },
    });
    const parsed =
      r.result?.structuredContent ??
      (r.result?.content?.[0]?.text ? JSON.parse(r.result.content[0].text) : null);
    check('validate_model openai/gpt-4', parsed?.valid === true, `got ${JSON.stringify(r.result)}`);
  }

  const bad = await rpc('tools/call', {
    name: 'chat_completion',
    arguments: { messages: [] },
  });
  check('INVALID_INPUT path works',
    bad.result?.isError && bad.result?._meta?.code === 'INVALID_INPUT',
    `got ${JSON.stringify(bad.result)}`);
} finally {
  proc.kill('SIGTERM');
  await delay(500);
}

console.log(failures === 0 ? '\nuvx smoke: PASS' : `\nuvx smoke: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
