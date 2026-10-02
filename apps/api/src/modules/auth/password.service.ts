import { randomBytes } from 'node:crypto';

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@planit/shared';
import argon2 from 'argon2';
import { PinoLogger } from 'nestjs-pino';

import { AppException } from '../../common/errors/app.exception.js';
import { HibpPasswordBreachChecker } from './password-breach.js';

/** OWASP Argon2id baseline: 19 MiB, 2 iterations, parallelism 1. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService implements OnModuleInit {
  /**
   * Hash of a random secret, used so a missing account still pays for one Argon2 verify.
   * It is not a password anyone can present: the caller also requires a real hash.
   */
  private dummyHash = '';

  constructor(
    private readonly breach: HibpPasswordBreachChecker,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(PasswordService.name);
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash(randomBytes(32).toString('base64url'), ARGON2_OPTIONS);
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(password: string, passwordHash: string | null): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash ?? this.dummyHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Rejects passwords that HIBP has seen. If the range API cannot be reached, the check
   * fails open: Argon2id and the rate limits remain, and we do not invent a result.
   */
  async assertNotBreached(password: string): Promise<void> {
    let breached = false;
    try {
      breached = await this.breach.isBreached(password);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn({ reason }, 'Breached-password check unavailable; allowing the password');
      return;
    }
    if (breached) {
      throw new AppException(
        ERROR_CODES.VALIDATION_ERROR,
        'This password has appeared in a data breach. Choose a different password.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
