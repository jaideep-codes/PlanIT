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
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://planit:planit_dev_password@127.0.0.1:5432/planit_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://:planit_dev_redis@127.0.0.1:6379/1',
      WEB_ORIGINS: 'http://localhost:3000',
      JWT_SIGNING_KEY: 'bG9jYWwtZGV2LWp3dC1zaWduaW5nLWtleS0zMmJ5dGU=',
      OTP_PEPPER: 'bG9jYWwtZGV2LW90cC1wZXBwZXItdmFsdWUtMzJieXQ=',
      OTP_JOB_ENCRYPTION_KEY: 'bG9jYWwtZGV2LW90cC1qb2Ita2V5LTMyLWJ5dGVzISE=',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GOOGLE_REDIRECT_URI: '',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_FROM: 'PlanIT <noreply@planit.local>',
    },
  },
});
