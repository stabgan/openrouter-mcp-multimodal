#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function read(relPath) {
  return readFileSync(new URL(relPath, import.meta.url), 'utf8');
}

const { version: pkgVersion } = JSON.parse(read('../package.json'));
const lock = JSON.parse(read('../package-lock.json'));
const manifest = JSON.parse(read('../.release-please-manifest.json'));
const versionTs = read('../src/version.ts');
const serverJson = JSON.parse(read('../server.json'));
const pyproject = read('../python/pyproject.toml');
const pyInit = read('../python/mcp_server_openrouter_multimodal/__init__.py');
const smithery = read('../smithery.yaml');
const changelog = read('../CHANGELOG.md');
const pinnedDocs = [
  ['README.md', read('../README.md')],
  ['python/README.md', read('../python/README.md')],
  ['llms.txt', read('../llms.txt')],
];

const errors = [];

if (lock.version !== pkgVersion) {
  errors.push(`package-lock.json version=${lock.version} (expected ${pkgVersion})`);
}
if (lock.packages?.['']?.version !== pkgVersion) {
  errors.push(
    `package-lock.json packages[''].version=${lock.packages?.['']?.version} (expected ${pkgVersion})`,
  );
}

if (manifest['.'] !== pkgVersion) {
  errors.push(`.release-please-manifest.json .=${manifest['.']} (expected ${pkgVersion})`);
}

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

const pyInitMatch = pyInit.match(/^__version__\s*=\s*"([^"]+)"/m);
if (!pyInitMatch) {
  errors.push('python/mcp_server_openrouter_multimodal/__init__.py: could not parse __version__');
} else if (pyInitMatch[1] !== pkgVersion) {
  errors.push(
    `python/mcp_server_openrouter_multimodal/__init__.py __version__=${pyInitMatch[1]} (expected ${pkgVersion})`,
  );
}

const smitheryMatch = smithery.match(/^version:\s*(\S+)/m);
if (!smitheryMatch) {
  errors.push('smithery.yaml: could not parse version');
} else if (smitheryMatch[1] !== pkgVersion) {
  errors.push(`smithery.yaml version=${smitheryMatch[1]} (expected ${pkgVersion})`);
}

const changelogMatch = changelog.match(/^## \[([^\]]+)\]/m);
if (!changelogMatch) {
  errors.push('CHANGELOG.md: could not parse top release section');
} else if (changelogMatch[1] !== pkgVersion) {
  errors.push(`CHANGELOG.md top section=[${changelogMatch[1]}] (expected [${pkgVersion}])`);
}

// Explicit install pins only: package@semver, OPENROUTER_MCP_NPM_VERSION=semver, ghcr tag.
// Skips unpinned @package refs and prose like "v4.7.0+" or historical changelog mentions.
const pinPatterns = [
  /@stabgan\/openrouter-mcp-multimodal@(\d+\.\d+\.\d+)/g,
  /OPENROUTER_MCP_NPM_VERSION=(\d+\.\d+\.\d+)/g,
  /ghcr\.io\/stabgan\/openrouter-mcp-multimodal:(\d+\.\d+\.\d+)/g,
  // Docker Hub tag; lookbehind avoids re-matching the ghcr.io form above.
  /(?<![\w./])stabgan\/openrouter-mcp-multimodal:(\d+\.\d+\.\d+)/g,
];
for (const [label, contents] of pinnedDocs) {
  for (const pattern of pinPatterns) {
    for (const match of contents.matchAll(pattern)) {
      if (match[1] !== pkgVersion) {
        errors.push(`${label} pin ${match[0]} (expected version ${pkgVersion})`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Version sync check failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log(`Version sync OK (${pkgVersion})`);
