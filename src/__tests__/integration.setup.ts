import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: path.join(repoRoot, '.env') });

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
  throw new Error(
    'OPENROUTER_API_KEY is required for integration tests. ' +
      'Set it in .env at the repo root or export it in the environment.',
  );
}
