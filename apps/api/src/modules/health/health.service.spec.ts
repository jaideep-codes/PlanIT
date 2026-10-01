import { readinessResponseSchema } from '@planit/shared';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { RedisService } from '../../infrastructure/redis/redis.service.js';
import { HealthService } from './health.service.js';

function createService(options: { database: boolean; redis: boolean }) {
  const prisma = {
    $queryRaw: vi.fn(() =>
      options.database
        ? Promise.resolve([{ '?column?': 1 }])
        : Promise.reject(new Error('ECONNREFUSED')),
    ),
  } as unknown as PrismaService;
  const redis = {
    ping: vi.fn(() => (options.redis ? Promise.resolve() : Promise.reject(new Error('down')))),
  } as unknown as RedisService;
  const logger = { warn: vi.fn(), setContext: vi.fn() } as unknown as PinoLogger;
  return new HealthService(prisma, redis, logger);
}

describe('HealthService.readiness', () => {
  it('is ready when every dependency is up', async () => {
    const result = await createService({ database: true, redis: true }).readiness();
    expect(result.status).toBe('ready');
    expect(readinessResponseSchema.safeParse(result).success).toBe(true);
  });

  it('is degraded, not failing, when only Redis is down', async () => {
    const result = await createService({ database: true, redis: false }).readiness();
    expect(result.status).toBe('degraded');
    expect(result.checks.redis.status).toBe('down');
  });

  it('is not ready when the database is down', async () => {
    const result = await createService({ database: false, redis: true }).readiness();
    expect(result.status).toBe('not_ready');
  });

  it('does not leak failure reasons into the response', async () => {
    const result = await createService({ database: false, redis: false }).readiness();
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
  });
});

describe('HealthService.liveness', () => {
  it('reports ok without touching dependencies', () => {
    const service = createService({ database: false, redis: false });
    expect(service.liveness().status).toBe('ok');
  });
});
