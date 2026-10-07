import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: path.join(repoRoot, '.env'), quiet: true });

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
  // Warn instead of throwing so `npm run ci` and `npm run test:all` pass
  // cleanly in environments without an API key (local dev, CI without
  // secrets). Integration tests self-skip via describe.skipIf().
  console.warn(
    '\n⚠  OPENROUTER_API_KEY not set — integration tests will be skipped.\n' +
      '   Set it in .env at the repo root or export it in the environment.\n',
  );
}
