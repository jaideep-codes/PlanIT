import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Options } from 'pino-http';

import type { Env } from '../../config/env.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id.js';

/**
 * Defence in depth: request/response serializers below already omit headers and bodies, but
 * any object a service logs is also scrubbed of these keys. Add new credential-bearing field
 * names here when they are introduced (see docs/security.md, "Logging").
 */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.otp',
  '*.otpCode',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  '*.apiKey',
  '*.secret',
  '*.clientSecret',
  '*.authorization',
  '*.cookie',
];

const LIVENESS_PATH = '/api/health';

function pathWithoutQuery(url: string | undefined): string | undefined {
  // Query strings can carry tokens; never log them.
  return url?.split('?')[0];
}

interface SerializedRequest {
  id?: unknown;
  method?: string;
  url?: string;
}

interface SerializedResponse {
  statusCode?: number;
}

export function buildPinoHttpOptions(
  env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>,
): Options<IncomingMessage, ServerResponse> {
  const pretty = env.NODE_ENV === 'development';

  return {
    level: env.LOG_LEVEL,
    genReqId: (req, res) => {
      const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    redact: { paths: REDACTED_LOG_PATHS, censor: '[REDACTED]' },
    serializers: {
      req: (req: SerializedRequest) => ({
        id: req.id,
        method: req.method,
        path: pathWithoutQuery(req.url),
      }),
      res: (res: SerializedResponse) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, error) => {
      if (error !== undefined || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: {
      ignore: (req) => pathWithoutQuery(req.url) === LIVENESS_PATH,
    },
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: {
            singleLine: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  };
}
