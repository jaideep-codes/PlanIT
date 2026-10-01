import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './env.js';

/**
 * Loads apps/api/.env in development (runtime environment variables take precedence) and
 * validates everything at boot. Tests inject configuration explicitly, so the file is ignored.
 * Consumers inject `ConfigService<Env, true>` and read values with `{ infer: true }`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
