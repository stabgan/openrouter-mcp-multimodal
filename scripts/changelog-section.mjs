#!/usr/bin/env node
/** Print one CHANGELOG.md section for a semver (e.g. 4.7.0). Exits 1 if missing. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const version = process.argv[2]?.trim();
if (!version) {
  console.error('Usage: node scripts/changelog-section.mjs <semver>');
  process.exit(1);
}

const changelog = readFileSync(
  fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)),
  'utf8',
);
const escaped = version.replace(/\./g, '\\.');
const re = new RegExp(`## \\[${escaped}\\][\\s\\S]*?(?=\\n## \\[|$)`);
const match = changelog.match(re);
if (!match) {
  console.error(`No CHANGELOG section for ${version}`);
  process.exit(1);
}
process.stdout.write(`${match[0].trim()}\n`);
