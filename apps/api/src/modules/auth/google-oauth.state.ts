import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@planit/shared';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { AppException } from '../../common/errors/app.exception.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { AUTH_UNAVAILABLE_MESSAGE, GOOGLE_STATE_TTL_SECONDS } from './auth.constants.js';
import { sha256Hex } from './crypto.js';
import type { StoredOAuthRequest } from './google-oauth.types.js';

export const GOOGLE_OAUTH_STATE_STORE = Symbol('GOOGLE_OAUTH_STATE_STORE');

export interface GoogleOAuthStateStore {
  save(state: string, value: StoredOAuthRequest): Promise<void>;
  consume(state: string): Promise<StoredOAuthRequest | null>;
}

const storedSchema = z.strictObject({
  verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
});

function stateKey(state: string): string {
  return `oauth:google:${sha256Hex(state)}`;
}

function unavailable(): AppException {
  return new AppException(
    ERROR_CODES.SERVICE_UNAVAILABLE,
    AUTH_UNAVAILABLE_MESSAGE,
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

/**
 * One-time Google authorization request. The Redis key is a hash of the state, and the value
 * is deleted on read so a callback cannot be replayed.
 */
@Injectable()
export class RedisGoogleOAuthStateStore implements GoogleOAuthStateStore {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(RedisGoogleOAuthStateStore.name);
  }

  async save(state: string, value: StoredOAuthRequest): Promise<void> {
    if (!this.redis.isAvailable) throw unavailable();
    try {
      const stored = await this.redis.client.set(
        stateKey(state),
        JSON.stringify(value),
        'EX',
        GOOGLE_STATE_TTL_SECONDS,
        'NX',
      );
      if (stored !== 'OK') throw unavailable();
    } catch (error) {
      if (error instanceof AppException) throw error;
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn({ reason }, 'Google state could not be stored');
      throw unavailable();
    }
  }

  async consume(state: string): Promise<StoredOAuthRequest | null> {
    if (!this.redis.isAvailable) throw unavailable();
    try {
      const raw = await this.redis.client.getdel(stateKey(state));
      if (typeof raw !== 'string') return null;
      const parsed: unknown = JSON.parse(raw);
      const stored = storedSchema.safeParse(parsed);
      return stored.success ? stored.data : null;
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (error instanceof SyntaxError) return null;
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn({ reason }, 'Google state could not be read');
      throw unavailable();
    }
  }
}
