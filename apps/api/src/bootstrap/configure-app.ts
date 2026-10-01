import type { NestApplicationOptions } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { REQUEST_ID_HEADER } from '../common/logging/request-id.js';
import type { Env } from '../config/env.js';

export const API_PREFIX = 'api';
const JSON_BODY_LIMIT = '256kb';

/** Options shared by main.ts and e2e tests so both run the same HTTP stack. */
export const APP_OPTIONS: NestApplicationOptions = {
  bufferLogs: true,
  // Registered explicitly below with a size limit.
  bodyParser: false,
};

export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));

  // The API only serves JSON, so its CSP forbids everything.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // API responses may contain private data; never let browsers or proxies cache them.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.enableCors({
    origin: config.get('WEB_ORIGINS', { infer: true }),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  });

  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });

  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
}
