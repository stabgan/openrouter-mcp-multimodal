#!/usr/bin/env node
/**
 * Fail CI when package.json, src/version.ts, server.json, and python/pyproject.toml
 * disagree on the semver. package.json is the source of truth.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function read(relPath) {
  return readFileSync(new URL(relPath, import.meta.url), 'utf8');
}

const { version: pkgVersion } = JSON.parse(read('../package.json'));
const versionTs = read('../src/version.ts');
const serverJson = JSON.parse(read('../server.json'));
const pyproject = read('../python/pyproject.toml');

const errors = [];

const tsMatch = versionTs.match(/SERVER_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!tsMatch) {
  errors.push('src/version.ts: could not parse SERVER_VERSION');
} else if (tsMatch[1] !== pkgVersion) {
  errors.push(`src/version.ts SERVER_VERSION=${tsMatch[1]} (expected ${pkgVersion})`);
}

if (serverJson.version !== pkgVersion) {
  errors.push(`server.json version=${serverJson.version} (expected ${pkgVersion})`);
}

for (const [i, pkg] of serverJson.packages.entries()) {
  if (pkg.version && pkg.version !== pkgVersion) {
    errors.push(`server.json packages[${i}].version=${pkg.version} (expected ${pkgVersion})`);
  }
  if (pkg.registryType === 'oci' && !pkg.identifier.endsWith(`:${pkgVersion}`)) {
    errors.push(
      `server.json packages[${i}].identifier=${pkg.identifier} (expected tag :${pkgVersion})`,
    );
  }
}

const pyMatch = pyproject.match(/^version\s*=\s*"([^"]+)"/m);
if (!pyMatch) {
  errors.push('python/pyproject.toml: could not parse version');
} else if (pyMatch[1] !== pkgVersion) {
  errors.push(`python/pyproject.toml version=${pyMatch[1]} (expected ${pkgVersion})`);
}

if (errors.length > 0) {
  console.error('Version sync check failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log(`Version sync OK (${pkgVersion})`);
