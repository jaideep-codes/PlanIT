import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.resolve(webRoot, '../api');

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://planit:planit_dev_password@127.0.0.1:5432/planit_test';

async function waitForMailpit(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:8025/readyz');
      if (response.ok) return;
    } catch {
      // Mailpit is still starting.
    }
    await delay(300);
  }
  throw new Error('Mailpit is not ready at http://127.0.0.1:8025. Start it with pnpm services:up.');
}

export default async function globalSetup(): Promise<void> {
  await waitForMailpit();
  const prisma = path.join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [prisma, 'migrate', 'deploy'], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  if (result.status !== 0) {
    throw new Error(
      'Applying migrations to the test database failed. Start Postgres with pnpm services:up.',
    );
  }
}
