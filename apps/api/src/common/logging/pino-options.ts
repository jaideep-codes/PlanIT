import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Options } from 'pino-http';

import type { Env } from '../../config/env.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id.js';

/**
 * Credential-bearing keys. Pino's `*` matches one path segment, so each key is listed at the
 * top level and at several nesting depths. `code` is the OTP request field; `text` is the
 * email body that carries it.
 */
const CREDENTIAL_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'password_hash',
  'otp',
  'otpCode',
  'verificationCode',
  'code',
  'codeHash',
  'token',
  'accessToken',
  'refreshToken',
  'refreshTokenHash',
  'idToken',
  'apiKey',
  'secret',
  'clientSecret',
  'authorization',
  'cookie',
  'set-cookie',
  'ciphertext',
  'pepper',
  'text',
  'pass',
  'smtpPassword',
  'JWT_SIGNING_KEY',
  'OTP_PEPPER',
  'OTP_JOB_ENCRYPTION_KEY',
  'SMTP_PASSWORD',
  'DATABASE_URL',
  'REDIS_URL',
] as const;

function pathsForCredential(key: string): string[] {
  const segment = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `["${key}"]`;
  return [0, 1, 2, 3, 4].map((depth) => `${'*.'.repeat(depth)}${segment}`);
}

/**
 * Defence in depth: request/response serializers below already omit headers and bodies, but
 * any object a service logs is also scrubbed of these keys. Add new credential-bearing field
 * names to CREDENTIAL_KEYS when they are introduced (see docs/security.md, "Logging").
 */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  ...CREDENTIAL_KEYS.flatMap(pathsForCredential),
];

/** Removes secrets that can sit inside an error string rather than under a redacted key. */
export function scrubSecretText(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*:[^\s@]*@/gi, '$1[REDACTED]@')
    .replace(/\$argon2[a-z0-9]+\$\S+/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/(?<![\d:])\d{6}(?![\d:])/g, '******');
}

/**
 * Logs the error name, a scrubbed message, and a non-secret code. The raw object is not
 * passed through: Prisma and driver errors can carry hashes, OTPs, or connection URLs.
 * `code` is renamed so the OTP field redaction does not hide a Prisma error code.
 */
export function serializeLoggedError(error: unknown): {
  type: string;
  message: string;
  stack?: string;
  errorCode?: string;
} {
  if (!(error instanceof Error)) {
    return { type: 'UnknownError', message: 'unknown error' };
  }
  const code = (error as { code?: unknown }).code;
  const errorCode = typeof code === 'string' && !/^\d{6}$/.test(code) ? code : undefined;
  const stack = error.stack ? scrubSecretText(error.stack) : undefined;
  return {
    type: error.name,
    message: scrubSecretText(error.message),
    ...(stack !== undefined && { stack }),
    ...(errorCode !== undefined && { errorCode }),
  };
}

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
      err: serializeLoggedError,
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
