import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../../config/env.js';

const CONNECT_TIMEOUT_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 5_000;
const RECONNECT_BACKOFF_STEP_MS = 200;

/**
 * Owns the general-purpose Redis connection (cache, rate-limit storage).
 * Commands fail fast instead of queueing while Redis is down, so callers can fall back to
 * the database: Redis is never the source of truth. BullMQ will use its own connections.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;
  private available = false;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(RedisService.name);
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      connectTimeout: CONNECT_TIMEOUT_MS,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) =>
        Math.min(attempt * RECONNECT_BACKOFF_STEP_MS, MAX_RECONNECT_DELAY_MS),
    });

    this.client.on('ready', () => {
      this.available = true;
      this.logger.info('Redis connection ready');
    });

    // ioredis emits an error per reconnect attempt; log only on the transition to unavailable.
    // The error message is logged rather than the object, which can contain the connection URL.
    this.client.on('error', (error: Error) => {
      if (!this.available) return;
      this.available = false;
      this.logger.warn({ reason: error.message }, 'Redis unavailable; continuing without cache');
    });
  }

  /**
   * Gives the initial connection a bounded chance to complete so the first requests after boot
   * are not needlessly served without cache. Boot continues (degraded) if Redis is down.
   */
  async onModuleInit(): Promise<void> {
    if (this.client.status === 'ready') return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.client.off('ready', onReady);
        this.logger.warn('Redis not ready at startup; continuing without cache');
        resolve();
      }, CONNECT_TIMEOUT_MS);
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      this.client.once('ready', onReady);
    });
  }

  get isAvailable(): boolean {
    return this.available;
  }

  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error('Unexpected Redis PING reply');
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
