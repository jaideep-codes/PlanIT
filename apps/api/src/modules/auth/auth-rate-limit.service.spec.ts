import { describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';

import type { RedisService } from '../../infrastructure/redis/redis.service.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';

function service(redis: Pick<RedisService, 'isAvailable' | 'client'>) {
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  return new AuthRateLimitService(redis as RedisService, logger);
}

describe('AuthRateLimitService', () => {
  it('fails closed when Redis is down', async () => {
    const limits = service({
      isAvailable: false,
      client: { eval: vi.fn() } as unknown as RedisService['client'],
    });
    await expect(
      limits.enforce('login', { ip: '127.0.0.1', email: 'ada@example.com' }),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('fails closed when the command errors', async () => {
    const limits = service({
      isAvailable: true,
      client: {
        eval: vi.fn().mockRejectedValue(new Error('connection reset')),
      } as unknown as RedisService['client'],
    });
    await expect(
      limits.enforce('signup', { ip: '127.0.0.1', email: 'ada@example.com' }),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('fails closed for password reset limits when Redis is down', async () => {
    const limits = service({
      isAvailable: false,
      client: { eval: vi.fn() } as unknown as RedisService['client'],
    });
    await expect(
      limits.enforce('passwordForgot', { ip: '127.0.0.1', email: 'ada@example.com' }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await expect(
      limits.enforce('passwordReset', { ip: '127.0.0.1', email: 'ada@example.com' }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('rejects when the counter passes the limit', async () => {
    const limits = service({
      isAvailable: true,
      client: { eval: vi.fn().mockResolvedValue([31, 40]) } as unknown as RedisService['client'],
    });
    await expect(limits.enforce('login', { ip: '127.0.0.1' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 40,
    });
  });
});
