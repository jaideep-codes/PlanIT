import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { z } from 'zod';

import { RedisService } from './redis.service.js';

const KEY_PREFIX = 'planit:';

/**
 * Cache-aside helper over Redis. Every operation fails open: a Redis outage turns reads
 * into misses and writes into no-ops, so callers always fall through to the source of truth.
 *
 * Rules (docs/caching.md):
 *  - every entry has a TTL;
 *  - cached values are re-validated with a Zod schema on read, so a shape change after a
 *    deploy is treated as a miss rather than served;
 *  - never cache secrets, credentials, or authorization decisions.
 */
@Injectable()
export class CacheService {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(CacheService.name);
  }

  async get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    let raw: string | null;
    try {
      raw = await this.redis.client.get(KEY_PREFIX + key);
    } catch (error) {
      this.logFailure('get', key, error);
      return undefined;
    }
    if (raw === null) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const result = schema.safeParse(parsed);
    return result.success ? result.data : undefined;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError('Cache TTL must be a positive integer number of seconds');
    }
    try {
      await this.redis.client.set(KEY_PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logFailure('set', key, error);
    }
  }

  async delete(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.client.del(...keys.map((key) => KEY_PREFIX + key));
    } catch (error) {
      this.logFailure('delete', keys.join(','), error);
    }
  }

  async getOrLoad<T>(
    key: string,
    ttlSeconds: number,
    schema: z.ZodType<T>,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get(key, schema);
    if (cached !== undefined) return cached;

    const fresh = await load();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  private logFailure(operation: string, cacheKey: string, error: unknown): void {
    this.logger.warn(
      { operation, cacheKey, reason: error instanceof Error ? error.message : 'unknown' },
      'Cache operation failed; falling back to source of truth',
    );
  }
}
