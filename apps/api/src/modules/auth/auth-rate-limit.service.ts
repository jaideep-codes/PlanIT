import { createHash } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@planit/shared';
import { PinoLogger } from 'nestjs-pino';

import { AppException } from '../../common/errors/app.exception.js';
import { RateLimitedException } from '../../common/errors/rate-limited.exception.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import {
  AUTH_RATE_LIMITS,
  AUTH_UNAVAILABLE_MESSAGE,
  type AuthLimitName,
} from './auth.constants.js';

const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export interface RateLimitIdentity {
  ip: string;
  email?: string;
  /** Opaque account or token key. Hashed again before it is used as a Redis key. */
  account?: string;
}

/**
 * Redis-backed limits for auth routes. A Redis outage rejects the request: these
 * counters are a security control, unlike the global throttler which fails open.
 */
@Injectable()
export class AuthRateLimitService {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(AuthRateLimitService.name);
  }

  async enforce(
    action: AuthLimitName,
    identity: RateLimitIdentity,
    limitedMessage?: string,
  ): Promise<void> {
    const spec = AUTH_RATE_LIMITS[action];
    const checks = [
      this.consume(
        `${action}:ip`,
        identity.ip,
        spec.ip.limit,
        spec.ip.windowSeconds,
        limitedMessage,
      ),
    ];
    if (identity.email !== undefined && 'email' in spec) {
      checks.push(
        this.consume(
          `${action}:email`,
          identity.email,
          spec.email.limit,
          spec.email.windowSeconds,
          limitedMessage,
        ),
      );
    }
    if (identity.account !== undefined && 'account' in spec) {
      checks.push(
        this.consume(
          `${action}:account`,
          identity.account,
          spec.account.limit,
          spec.account.windowSeconds,
          limitedMessage,
        ),
      );
    }
    await Promise.all(checks);
  }

  private async consume(
    scope: string,
    identity: string,
    limit: number,
    windowSeconds: number,
    limitedMessage?: string,
  ): Promise<void> {
    if (!this.redis.isAvailable) this.failClosed('Redis unavailable');
    const key = `rl:auth:${scope}:${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
    try {
      const raw: unknown = await this.redis.client.eval(SCRIPT, 1, key, String(windowSeconds));
      if (!Array.isArray(raw) || raw.length < 2) this.failClosed('Unexpected rate-limit reply');
      const count = Number(raw[0]);
      const ttl = Number(raw[1]);
      if (!Number.isFinite(count) || !Number.isFinite(ttl))
        this.failClosed('Unexpected rate-limit reply');
      if (count > limit) throw new RateLimitedException(Math.max(1, ttl), limitedMessage);
    } catch (error) {
      if (error instanceof AppException) throw error;
      const reason = error instanceof Error ? error.message : 'unknown';
      this.failClosed(reason);
    }
  }

  private failClosed(reason: string): never {
    this.logger.warn({ reason }, 'Auth rate limit unavailable; failing closed');
    throw new AppException(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      AUTH_UNAVAILABLE_MESSAGE,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
