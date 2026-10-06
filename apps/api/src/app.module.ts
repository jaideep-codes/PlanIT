import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PinoLogger } from 'nestjs-pino';

import { GlobalExceptionFilter } from './common/errors/global-exception.filter.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { AppConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { RedisThrottlerStorage } from './infrastructure/redis/redis-throttler.storage.js';
import { RedisService } from './infrastructure/redis/redis.service.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EntitlementModule } from './modules/entitlements/entitlement.module.js';
import { RecurringTasksModule } from './modules/recurring-tasks/recurring-tasks.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    RedisModule,
    // Baseline per-IP limit. Storage is Redis and fails open. Auth routes add stricter
    // named limits that fail closed (AuthRateLimitService).
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, RedisService, PinoLogger],
      useFactory: (config: ConfigService<Env, true>, redis: RedisService, logger: PinoLogger) => ({
        storage: new RedisThrottlerStorage(redis, logger),
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
    AuditModule,
    EntitlementModule,
    AuthModule,
    UsersModule,
    TasksModule,
    RecurringTasksModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
