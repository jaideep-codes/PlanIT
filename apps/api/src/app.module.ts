import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { GlobalExceptionFilter } from './common/errors/global-exception.filter.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { AppConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    // Baseline per-IP limit for every route. Sensitive routes (login, OTP, AI, ...) add
    // stricter named limits in their own phases; storage moves to Redis in Phase 2.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            name: 'default',
            ttl: seconds(config.get('RATE_LIMIT_WINDOW_SECONDS', { infer: true })),
            limit: config.get('RATE_LIMIT_MAX_REQUESTS', { infer: true }),
          },
        ],
      }),
    }),
    DatabaseModule,
    RedisModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
