#!/usr/bin/env node
/**
 * End-to-end builder for the Smithery-ready MCPB bundle.
 *
 * Why this script exists: the two tools that validate MCPB bundles
 * disagree.
 *   - `@anthropic-ai/mcpb pack` rejects `inputSchema` / `outputSchema`
 *     / `annotations` as "unknown keys" and refuses to produce a zip.
 *   - The Smithery Registry's publish endpoint requires each tool to
 *     carry its `inputSchema` (otherwise returns 400 "expected object,
 *     received undefined" once per missing tool).
 *
 * So we pack with a stripped manifest, then swap in the enriched
 * manifest inside the zip after the fact. The final `.mcpb` is
 * structurally a plain zip with:
 *   manifest.json  — full shape for Smithery
 *   server/        — compiled dist/
 *   node_modules/  — production deps
 *   package*.json  — bundle metadata
 *
 * Usage:
 *   npm run build        # populate dist/
 *   node scripts/build-mcpb-bundle.mjs
 *
 * Output:
 *   openrouter-mcp-multimodal.mcpb
 *
 * Subsequent:
 *   npx -y smithery@latest mcp publish ./openrouter-mcp-multimodal.mcpb \
 *     -n stabgan/openrouter-mcp-multimodal
 */
import { execSync } from 'node:child_process';
import {
  cpSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';

const BUILD_DIR = '.mcpb-build';
const OUT_FILE = 'openrouter-mcp-multimodal.mcpb';
const TOOLS_CLEAN = '/tmp/tools-clean.json';
const MANIFEST_LEAN = '/tmp/manifest-lean.json';
const MANIFEST_ENRICHED = '/tmp/manifest-enriched.json';

function run(cmd, opts = {}) {
  console.log('$ ' + cmd);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function runQuiet(cmd, opts = {}) {
  execSync(cmd, { stdio: 'pipe', ...opts });
}

// 1. Reset staging dir
if (existsSync(OUT_FILE)) rmSync(OUT_FILE);
if (existsSync(BUILD_DIR)) rmSync(BUILD_DIR, { recursive: true, force: true });
mkdirSync(path.join(BUILD_DIR, 'server'), { recursive: true });

// 2. Ensure dist/ exists — caller is expected to have run npm run build
if (!existsSync('dist')) {
  console.error('ERROR: dist/ does not exist. Run `npm run build` first.');
  process.exit(1);
}

// 3. Dump live tool schemas
console.log('[1/5] Dumping tool schemas…');
runQuiet(`node scripts/dump-tools.mjs > ${TOOLS_CLEAN} 2>/dev/null`);
const allTools = JSON.parse(readFileSync(TOOLS_CLEAN, 'utf8'));
console.log(`      ${allTools.length} tools: ${allTools.map((t) => t.name).join(', ')}`);

// 4. Write LEAN manifest (pack-friendly) and build
console.log('[2/5] Building lean manifest for mcpb pack…');
const leanTools = allTools.map((t) => ({
  name: t.name,
  description: String(t.description ?? '').split('\n\n')[0].trim(),
}));
writeFileSync(TOOLS_CLEAN, JSON.stringify(leanTools));
run('node scripts/build-manifest.mjs');
cpSync(path.join(BUILD_DIR, 'manifest.json'), MANIFEST_LEAN);

// 5. Write ENRICHED manifest (Smithery-friendly) for later injection
console.log('[3/5] Building enriched manifest for Smithery…');
writeFileSync(TOOLS_CLEAN, JSON.stringify(allTools));
run('node scripts/build-manifest.mjs');
cpSync(path.join(BUILD_DIR, 'manifest.json'), MANIFEST_ENRICHED);

// 6. Restore the LEAN manifest so mcpb pack accepts it
cpSync(MANIFEST_LEAN, path.join(BUILD_DIR, 'manifest.json'));

// 7. Stage server code + deps
console.log('[4/5] Staging server + production deps…');
cpSync('dist', path.join(BUILD_DIR, 'server'), { recursive: true });
for (const f of ['package.json', 'package-lock.json', 'README.md', 'LICENSE']) {
  cpSync(f, path.join(BUILD_DIR, f));
}
run(`npm install --prefix ${BUILD_DIR} --omit=dev --prefer-offline --no-audit --no-fund`, {
  stdio: 'pipe',
});

// 8. Pack (with lean manifest) then inject the enriched one
console.log('[5/5] Packing + injecting enriched manifest…');
run(`npx -y @anthropic-ai/mcpb pack ${BUILD_DIR} ${OUT_FILE}`);
// Replace manifest.json inside the zip with the enriched copy
cpSync(MANIFEST_ENRICHED, 'manifest.json');
run(`zip -j ${OUT_FILE} manifest.json`);
rmSync('manifest.json');

// 9. Verify
const { size } = await import('node:fs').then((fs) => fs.promises.stat(OUT_FILE));
console.log(`\n✓ ${OUT_FILE} — ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log('\nNext: npx -y smithery@latest mcp publish ./' + OUT_FILE + ' -n stabgan/openrouter-mcp-multimodal');
