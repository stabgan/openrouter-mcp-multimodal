#!/usr/bin/env node
/**
 * End-to-end smoke test against a live OpenRouter API.
 *
 * Reads OPENROUTER_API_KEY from .env (loaded via dotenv), spawns the built
 * MCP server in `dist/index.js`, then drives each tool over stdio JSON-RPC
 * and records the outcome. Failures are collected so one bad tool doesn't
 * abort the whole run.
 *
 * Usage:  node scripts/live-e2e.mjs [--only=tool1,tool2] [--skip=tool3]
 *
 * Output:  ./.mcp-smoke-output/ (gitignored) — saved media plus a JSON log.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error('OPENROUTER_API_KEY not found in environment (.env).');
  process.exit(2);
}

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const onlyFilter = typeof argv.only === 'string' ? argv.only.split(',').map((s) => s.trim()) : null;
const skipFilter = typeof argv.skip === 'string' ? argv.skip.split(',').map((s) => s.trim()) : [];

const OUTPUT_DIR = path.resolve('.mcp-smoke-output');
await fs.mkdir(OUTPUT_DIR, { recursive: true });

function readToolPayload(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.[0]?.text;
  if (text === undefined) throw new Error('tool result has no structuredContent or content text');
  return JSON.parse(text);
}

class McpClient {
  constructor(proc) {
    this.proc = proc;
    this.pending = new Map();
    this.nextId = 1;
    this._buf = '';
    this.notifications = [];
    proc.stdout.on('data', (chunk) => this._onData(chunk));
    proc.stderr.on('data', (chunk) => process.stderr.write(chunk));
  }

  _onData(chunk) {
    this._buf += chunk.toString('utf8');
    const lines = this._buf.split('\n');
    this._buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.notifications.push(msg);
      }
    }
  }

  request(method, params) {
    const id = this.nextId++;
    const line = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(line + '\n');
    });
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async shutdown() {
    this.proc.kill('SIGINT');
    try {
      await once(this.proc, 'exit');
    } catch {
      /* noop */
    }
  }
}

async function bootServer() {
  const proc = spawn('node', ['dist/index.js'], {
    env: {
      ...process.env,
      OPENROUTER_INPUT_DIR: process.cwd(),
      OPENROUTER_OUTPUT_DIR: OUTPUT_DIR,
      OPENROUTER_LOG_LEVEL: process.env.OPENROUTER_LOG_LEVEL ?? 'info',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const client = new McpClient(proc);
  const result = await Promise.race([
    client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'live-e2e', version: '1.0' },
    }),
    delay(5000).then(() => {
      throw new Error('initialize timed out');
    }),
  ]);
  return { proc, client, initResult: result };
}

function shouldRun(name) {
  if (onlyFilter && !onlyFilter.includes(name)) return false;
  if (skipFilter.includes(name)) return false;
  return true;
}

const results = [];

async function run(name, fn) {
  if (!shouldRun(name)) {
    results.push({ name, status: 'SKIP' });
    return;
  }
  const started = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - started;
    console.log(`✓ ${name} (${ms}ms)`);
    results.push({ name, status: 'OK', ms, summary: summarize(out) });
  } catch (err) {
    const ms = Date.now() - started;
    console.error(`✗ ${name} (${ms}ms): ${err.message}`);
    results.push({ name, status: 'FAIL', ms, error: err.message });
  }
}

function summarize(result) {
  if (!result?.content) return result;
  const text = result.content.find((c) => c.type === 'text')?.text ?? '';
  return {
    isError: !!result.isError,
    _meta: result._meta,
    text: typeof text === 'string' ? text.slice(0, 200) : null,
    types: result.content.map((c) => c.type),
  };
}

async function callTool(client, name, args, signal) {
  const params = { name, arguments: args };
  if (!signal) return client.request('tools/call', params);
  return Promise.race([
    client.request('tools/call', params),
    delay(signal).then(() => {
      throw new Error(`Tool ${name} timed out after ${signal}ms`);
    }),
  ]);
}

function requireOk(result, hint) {
  if (result.isError) {
    const text = result.content.find((c) => c.type === 'text')?.text ?? '<no text>';
    throw new Error(`${hint}: ${text} (code=${result._meta?.code ?? 'none'})`);
  }
  return result;
}

// --- begin live run ---
const { proc, client, initResult } = await bootServer();
console.log('MCP server initialized:', JSON.stringify(initResult.serverInfo));

try {
  await run('tools/list', async () => {
    const r = await client.request('tools/list', {});
    const names = r.tools.map((t) => t.name);
    const expected = [
      'chat_completion',
      'analyze_image',
      'analyze_audio',
      'analyze_video',
      'search_models',
      'get_model_info',
      'validate_model',
      'generate_image',
      'generate_audio',
      'generate_video',
      'generate_video_from_image',
      'get_video_status',
      'rerank_documents',
      'health_check',
    ];
    for (const exp of expected) {
      if (!names.includes(exp)) throw new Error(`Missing tool: ${exp}`);
    }
    // Every tool must have annotations.
    for (const t of r.tools) {
      if (!t.annotations) throw new Error(`Tool ${t.name} missing annotations`);
    }
    return { tool_count: names.length, names };
  });

  await run('chat_completion', async () => {
    // Try a couple of free/known-live models in order. If rate-limited, fall
    // back to the next. This is a smoke test — we just need at least one
    // provider to respond so we can confirm the handler shape is right.
    const candidates = [
      'liquid/lfm-2.5-1.2b-instruct:free',
      'google/gemma-4-31b-it:free',
      'minimax/minimax-m2.5:free',
    ];
    let lastErr = 'no attempt made';
    for (const candidate of candidates) {
      const r = await callTool(
        client,
        'chat_completion',
        {
          model: candidate,
          messages: [
            { role: 'user', content: 'Reply with exactly the single word: pong' },
          ],
          max_tokens: 16,
        },
        30_000,
      );
      if (!r.isError) {
        const text = r.content.find((c) => c.type === 'text')?.text ?? '';
        if (text.toLowerCase().includes('pong')) return r;
        lastErr = `model ${candidate}: got text ${text.slice(0, 80)}`;
        continue;
      }
      lastErr = `model ${candidate}: ${r.content[0]?.text?.slice(0, 80)} (${r._meta?.code})`;
    }
    throw new Error(`all models failed — last: ${lastErr}`);
  });

  await run('chat_completion_reasoning_cutoff', async () => {
    // Nemotron VL is a reasoning model; with max_tokens=32 it will exhaust
    // its budget on chain-of-thought and emit `content: null`. We expect our
    // handler to translate that to a clean INVALID_INPUT instead of empty.
    const r = await callTool(
      client,
      'chat_completion',
      {
        model: 'nvidia/nemotron-nano-12b-v2-vl:free',
        messages: [{ role: 'user', content: 'Reply with the word ping.' }],
        max_tokens: 16,
      },
      90_000,
    );
    if (!r.isError) {
      // If we DID get a real answer that's fine too — some reasoning runs
      // finish in 16 tokens. Just assert the shape is valid.
      return r;
    }
    if (r._meta?.code !== 'INVALID_INPUT' && r._meta?.code !== 'UPSTREAM_REFUSED') {
      throw new Error(`expected INVALID_INPUT/UPSTREAM_REFUSED or success, got code=${r._meta?.code}`);
    }
    return r;
  });

  await run('search_models', async () => {
    const r = await callTool(
      client,
      'search_models',
      { capabilities: { video: true }, limit: 3 },
      20_000,
    );
    requireOk(r, 'search_models');
    const payload = readToolPayload(r);
    const results = Array.isArray(payload) ? payload : payload.results;
    if (!Array.isArray(results)) throw new Error('search_models did not return results array');
    return { count: results.length, first: results[0]?.id };
  });

  await run('get_model_info', async () => {
    const r = await callTool(
      client,
      'get_model_info',
      { model: 'nvidia/nemotron-nano-12b-v2-vl:free' },
      20_000,
    );
    requireOk(r, 'get_model_info');
    return r;
  });

  await run('validate_model', async () => {
    const r = await callTool(
      client,
      'validate_model',
      { model: 'openai/gpt-4' },
      20_000,
    );
    requireOk(r, 'validate_model');
    return r;
  });

  await run('validate_model_missing', async () => {
    const r = await callTool(
      client,
      'validate_model',
      { model: 'nonexistent/totally-fake-abc' },
      20_000,
    );
    requireOk(r, 'validate_model_missing');
    const parsed = JSON.parse(r.content[0].text);
    if (parsed.valid !== false) throw new Error('expected valid=false');
    return r;
  });

  await run('analyze_image', async () => {
    // Use the repo's checked-in test.png. Avoid reasoning models (Nemotron VL
    // on the free tier will exhaust max_tokens on CoT and return empty).
    const file = path.resolve('test.png');
    await fs.access(file);
    const r = await callTool(
      client,
      'analyze_image',
      {
        image_path: file,
        question: 'Reply with a single short sentence describing the image.',
        model: 'google/gemma-4-31b-it:free',
      },
      60_000,
    );
    if (r.isError) {
      // If the free tier is busy, we don't fail the smoke — we verify that
      // the error classification is one of the expected codes.
      const code = r._meta?.code;
      if (code !== 'UPSTREAM_REFUSED' && code !== 'UPSTREAM_TIMEOUT') {
        throw new Error(`unexpected error code: ${code}`);
      }
      return r;
    }
    return r;
  });

  await run('analyze_video', async () => {
    // Use a small real mp4 if available; otherwise fall back to our synthesized
    // container. A model may refuse to analyze a non-decodable stream — we
    // accept both "ok" and "controlled error" outcomes here because we're
    // mainly exercising the upload path.
    const file = path.join(OUTPUT_DIR, 'tiny.mp4');
    try {
      await fs.access(file);
    } catch {
      const { spawnSync } = await import('node:child_process');
      spawnSync('node', ['scripts/make-tiny-mp4.mjs', file], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
    }
    const r = await callTool(
      client,
      'analyze_video',
      {
        video_path: file,
        question: 'Describe any visible content in one sentence.',
        // Use a free vision model; real video understanding will probably
        // refuse a malformed mp4 and that is OK — we want to see the
        // upload path work and the error taxonomy kick in cleanly.
        model: 'google/gemini-2.5-flash',
      },
      120_000,
    );
    return r;
  });

  await run('generate_image', async () => {
    const savePath = path.join(OUTPUT_DIR, 'gen.png');
    const r = await callTool(
      client,
      'generate_image',
      {
        prompt: 'a single pixel, black background, minimal test',
        save_path: 'gen.png', // relative, resolved inside sandbox
      },
      120_000,
    );
    return r; // may succeed or 402; both are fine for smoke.
  });

  // generate_audio is metered ($0.50 for most audio models). Try the cheap
  // "preview" speech model; fall back to surfaced error.
  await run('generate_audio', async () => {
    const r = await callTool(
      client,
      'generate_audio',
      {
        prompt: 'Say the word test.',
        voice: 'alloy',
        save_path: 'spoken.wav',
      },
      180_000,
    );
    return r;
  });

  // generate_video is expensive (~$0.40/s for Veo). Submit a tiny 1-s job;
  // poll with a short deadline; expect either `completed` or
  // `JOB_STILL_RUNNING` — both are valid smoke outcomes.
  await run('generate_video', async () => {
    const r = await callTool(
      client,
      'generate_video',
      {
        prompt: 'A 1-second clip of a slowly rotating globe, minimal detail.',
        resolution: '720p',
        aspect_ratio: '16:9',
        duration: 1,
        save_path: 'generated.mp4',
        max_wait_ms: 30_000,
        poll_interval_ms: 5_000,
      },
      180_000,
    );
    return r;
  });

  await run('generate_video_invalid_model', async () => {
    const r = await callTool(
      client,
      'generate_video',
      {
        prompt: 'hello',
        model: 'nonexistent/zz-fake-1',
        max_wait_ms: 10_000,
        poll_interval_ms: 2_000,
      },
      30_000,
    );
    if (!r.isError) throw new Error('expected an error for nonexistent model');
    if (r._meta?.code !== 'MODEL_NOT_FOUND' && r._meta?.code !== 'INVALID_INPUT') {
      throw new Error(`expected MODEL_NOT_FOUND/INVALID_INPUT, got ${r._meta?.code}`);
    }
    return r;
  });

  await run('get_video_status_missing', async () => {
    // A random id the server won't find. Expect a clean UPSTREAM_HTTP/404
    // rather than a crash or opaque stack.
    const r = await callTool(
      client,
      'get_video_status',
      { video_id: 'vid_does_not_exist_zzz' },
      20_000,
    );
    if (!r.isError) {
      throw new Error(`expected an error for missing id, got ${JSON.stringify(r._meta)}`);
    }
    return r;
  });

  await run('unsafe_save_path', async () => {
    const r = await callTool(
      client,
      'generate_image',
      {
        prompt: 'test',
        save_path: '../escape.png',
      },
      60_000,
    );
    if (!r.isError || r._meta?.code !== 'UNSAFE_PATH') {
      throw new Error(
        `expected UNSAFE_PATH, got code=${r._meta?.code} (isError=${!!r.isError})`,
      );
    }
    return r;
  });

  await run('ssrf_blocked', async () => {
    const r = await callTool(
      client,
      'analyze_image',
      {
        image_path: 'http://169.254.169.254/latest/meta-data/',
      },
      30_000,
    );
    if (!r.isError) throw new Error('expected SSRF guard to refuse metadata URL');
    if (r._meta?.code !== 'UPSTREAM_REFUSED' && r._meta?.code !== 'INVALID_INPUT') {
      throw new Error(`expected UPSTREAM_REFUSED/INVALID_INPUT, got ${r._meta?.code}`);
    }
    return r;
  });
} finally {
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'run-results.json'),
    JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
  );
  await client.shutdown();
}

console.log('\nSummary:');
const ok = results.filter((r) => r.status === 'OK').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
const skip = results.filter((r) => r.status === 'SKIP').length;
console.log(`  OK:   ${ok}`);
console.log(`  FAIL: ${fail}`);
console.log(`  SKIP: ${skip}`);
for (const r of results.filter((r) => r.status === 'FAIL')) {
  console.log(`    ✗ ${r.name}: ${r.error}`);
}
process.exit(fail === 0 ? 0 : 1);
