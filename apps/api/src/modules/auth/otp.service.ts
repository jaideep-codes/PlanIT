import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@planit/shared';
import { PinoLogger } from 'nestjs-pino';

import { AppException } from '../../common/errors/app.exception.js';
import { RateLimitedException } from '../../common/errors/rate-limited.exception.js';
import type { Env } from '../../config/env.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { EmailQueueService } from '../../infrastructure/queue/email-queue.service.js';
import {
  AUTH_UNAVAILABLE_MESSAGE,
  INVALID_CODE_MESSAGE,
  OTP_ATTEMPTS_MESSAGE,
  OTP_HOUR_MS,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_HOUR,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MESSAGE,
  RESEND_HOURLY_MESSAGE,
} from './auth.constants.js';
import { AuthRepository } from './auth.repository.js';
import { generateOtpCode, otpCodeHash, otpMatches } from './crypto.js';
import { OtpRepository, type OtpPurpose } from './otp.repository.js';

@Injectable()
export class OtpService {
  private readonly pepper: Buffer;
  private readonly dummyHash: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly otps: OtpRepository,
    private readonly accounts: AuthRepository,
    private readonly email: EmailQueueService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(OtpService.name);
    this.pepper = Buffer.from(config.get('OTP_PEPPER', { infer: true }), 'base64');
    this.dummyHash = otpCodeHash(this.pepper, '000000');
  }

  /** Spends an HMAC compare so a missing account is not obviously cheaper. */
  burn(code: string): void {
    otpMatches(this.pepper, code, this.dummyHash);
  }

  /**
   * `strict` surfaces cooldown and hourly-cap errors (the resend endpoint).
   * `silent` skips sending and returns, so signup and password-reset requests stay
   * indistinguishable when a limit has already been reached in the database.
   * The message is the code itself. It never contains a link.
   */
  async issue(
    userId: string,
    email: string,
    mode: 'strict' | 'silent',
    purpose: OtpPurpose = 'EMAIL_VERIFICATION',
  ): Promise<'sent' | 'skipped'> {
    const latest = await this.otps.latest(email, purpose);
    if (latest && Date.now() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      if (mode === 'strict') {
        const retryAfter = Math.ceil(
          (OTP_RESEND_COOLDOWN_MS - (Date.now() - latest.createdAt.getTime())) / 1000,
        );
        throw new RateLimitedException(Math.max(1, retryAfter), RESEND_COOLDOWN_MESSAGE);
      }
      return 'skipped';
    }
    const sentRecently = await this.otps.countSince(
      email,
      purpose,
      new Date(Date.now() - OTP_HOUR_MS),
    );
    if (sentRecently >= OTP_MAX_PER_HOUR) {
      if (mode === 'strict')
        throw new RateLimitedException(OTP_HOUR_MS / 1000, RESEND_HOURLY_MESSAGE);
      return 'skipped';
    }

    const code = generateOtpCode();
    const created = await this.otps.createActive({
      userId,
      email,
      purpose,
      codeHash: otpCodeHash(this.pepper, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });
    const copy = otpEmailCopy(purpose, code);
    try {
      await this.email.enqueue(`otp-email-${created.id}`, {
        to: email,
        subject: copy.subject,
        text: copy.text,
      });
    } catch (error) {
      await this.otps.deleteById(created.id);
      const reason =
        error instanceof Error ? error.message.replace(/\d{6}/g, '******') : 'enqueue failed';
      this.logger.error({ reason }, 'Failed to queue verification email');
      throw new AppException(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        AUTH_UNAVAILABLE_MESSAGE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return 'sent';
  }

  async verify(email: string, code: string): Promise<void> {
    const outcome = await this.otps.transaction(async (tx) => {
      const row = await this.otps.lockActive(tx, email, 'EMAIL_VERIFICATION');
      if (!row || row.consumedAt !== null || row.userId === null) {
        otpMatches(this.pepper, code, this.dummyHash);
        return 'invalid' as const;
      }
      const matches = otpMatches(this.pepper, code, row.codeHash);
      if (row.attempts >= OTP_MAX_ATTEMPTS) return 'attempts' as const;
      if (!matches) {
        await this.otps.setAttempts(tx, row.id, row.attempts + 1);
        return 'invalid' as const;
      }
      const now = new Date();
      await this.otps.consume(tx, row.id, now);
      await this.accounts.markEmailVerified(tx, row.userId, now);
      return 'verified' as const;
    });

    if (outcome === 'verified') return;
    if (outcome === 'attempts') {
      throw new RateLimitedException(Math.ceil(OTP_TTL_MS / 1000), OTP_ATTEMPTS_MESSAGE);
    }
    throw new AppException(ERROR_CODES.BAD_REQUEST, INVALID_CODE_MESSAGE, HttpStatus.BAD_REQUEST);
  }

  /**
   * Checks a code and increments the attempt counter on a mismatch. A match does not
   * consume the row, so a later password-policy failure can retry the same code.
   */
  async matchActive(
    email: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<'invalid' | 'attempts' | { userId: string }> {
    return this.otps.transaction(async (tx) => {
      const row = await this.otps.lockActive(tx, email, purpose);
      if (!row || row.consumedAt !== null || row.userId === null) {
        otpMatches(this.pepper, code, this.dummyHash);
        return 'invalid';
      }
      if (row.attempts >= OTP_MAX_ATTEMPTS) return 'attempts';
      if (!otpMatches(this.pepper, code, row.codeHash)) {
        await this.otps.setAttempts(tx, row.id, row.attempts + 1);
        return 'invalid';
      }
      return { userId: row.userId };
    });
  }

  /** Consumes a still-active matching code inside the caller's transaction. */
  async consumeMatching(
    tx: DbClient,
    email: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<{ userId: string } | null> {
    const row = await this.otps.lockActive(tx, email, purpose);
    if (!row || row.consumedAt !== null || row.userId === null) {
      otpMatches(this.pepper, code, this.dummyHash);
      return null;
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) return null;
    if (!otpMatches(this.pepper, code, row.codeHash)) return null;
    await this.otps.consume(tx, row.id, new Date());
    return { userId: row.userId };
  }
}

function otpEmailCopy(purpose: OtpPurpose, code: string): { subject: string; text: string } {
  if (purpose === 'PASSWORD_RESET') {
    return {
      subject: 'Your PlanIT password reset code',
      text: [
        `Your PlanIT password reset code is ${code}.`,
        'It expires in 10 minutes.',
        'If you did not ask to reset your password, you can ignore this message.',
      ].join('\n'),
    };
  }
  return {
    subject: 'Your PlanIT verification code',
    text: [
      `Your PlanIT verification code is ${code}.`,
      'It expires in 10 minutes.',
      'If you did not create a PlanIT account, you can ignore this message.',
    ].join('\n'),
  };
}
