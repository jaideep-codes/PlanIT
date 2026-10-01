import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// End-to-end tests boot the real application against the dedicated `planit_test` database
// and Redis from docker-compose. CI overrides these through environment variables.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://planit:planit_dev_password@127.0.0.1:5432/planit_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://:planit_dev_redis@127.0.0.1:6379/1',
      WEB_ORIGINS: 'http://localhost:3000',
    },
  },
});
