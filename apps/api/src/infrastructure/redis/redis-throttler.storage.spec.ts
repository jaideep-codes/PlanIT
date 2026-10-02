import { describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';

import type { RedisService } from './redis.service.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

describe('RedisThrottlerStorage', () => {
  it('fails open when Redis errors', async () => {
    const redis = {
      isAvailable: true,
      client: { incr: vi.fn().mockRejectedValue(new Error('down')) },
    } as unknown as RedisService;
    const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
    const storage = new RedisThrottlerStorage(redis, logger);
    await expect(storage.increment('k', 60_000, 10, 60_000, 'default')).resolves.toMatchObject({
      isBlocked: false,
    });
  });
});
