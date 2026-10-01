import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env files itself. Already-set environment variables win, so CI and
// deployment platforms can inject DATABASE_URL without a file.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // `prisma generate` does not need a database, so an absent URL is allowed here;
    // migrate/studio fail loudly without it.
    url: process.env.DATABASE_URL ?? '',
  },
});
