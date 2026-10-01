import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { APP_OPTIONS, configureApp } from './bootstrap/configure-app.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, APP_OPTIONS);
  configureApp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const host = config.get('HOST', { infer: true });
  const port = config.get('PORT', { infer: true });

  await app.listen(port, host);
  app.get(Logger).log(`PlanIT API listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet (e.g. invalid environment), so write directly to stderr.
  process.stderr.write(
    `PlanIT API failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
