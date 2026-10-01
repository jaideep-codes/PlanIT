import { Injectable } from '@nestjs/common';
import type { DependencyCheck, LivenessResponse, ReadinessResponse } from '@planit/types';
import { PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';

export const DEPENDENCY_CHECK_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(HealthService.name);
  }

  liveness(): LivenessResponse {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * The database is required; Redis is not (it is never the source of truth), so a Redis
   * outage reports `degraded` while the API keeps serving.
   */
  async readiness(): Promise<ReadinessResponse> {
    const [database, redis] = await Promise.all([
      this.check('database', () => this.prisma.$queryRaw`SELECT 1`),
      this.check('redis', () => this.redis.ping()),
    ]);

    let status: ReadinessResponse['status'] = 'ready';
    if (database.status === 'down') status = 'not_ready';
    else if (redis.status === 'down') status = 'degraded';

    return { status, checks: { database, redis }, timestamp: new Date().toISOString() };
  }

  private async check(name: string, probe: () => Promise<unknown>): Promise<DependencyCheck> {
    const startedAt = performance.now();
    const latency = () => Math.round(performance.now() - startedAt);
    try {
      await withTimeout(probe(), DEPENDENCY_CHECK_TIMEOUT_MS);
      return { status: 'up', latencyMs: latency() };
    } catch (error) {
      // Failure detail stays in server logs; the response only says "down".
      this.logger.warn(
        { dependency: name, reason: error instanceof Error ? error.message : 'unknown' },
        'Dependency check failed',
      );
      return { status: 'down', latencyMs: latency() };
    }
  }
}
