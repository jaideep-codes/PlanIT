import type { ThrottlerStorage } from '@nestjs/throttler';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}
import { PinoLogger } from 'nestjs-pino';

import { RedisService } from './redis.service.js';

/**
 * Global throttler storage. A Redis error fails open (the request proceeds) because this
 * baseline limit is not the control that protects credential routes. Those use
 * AuthRateLimitService, which fails closed.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(RedisThrottlerStorage.name);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttle:${throttlerName}:${key}`;
    try {
      if (!this.redis.isAvailable) return this.allow();
      const hits = await this.redis.client.incr(redisKey);
      if (hits === 1) await this.redis.client.pexpire(redisKey, ttl);
      const pttl = await this.redis.client.pttl(redisKey);
      const timeToExpire = Math.max(0, Math.ceil(pttl / 1000));
      const isBlocked = hits > limit;
      return {
        totalHits: hits,
        timeToExpire,
        isBlocked,
        timeToBlockExpire: isBlocked ? timeToExpire : 0,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn({ reason }, 'Global rate limit storage unavailable; failing open');
      return this.allow();
    }
  }

  private allow(): ThrottlerStorageRecord {
    return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
  }
}
