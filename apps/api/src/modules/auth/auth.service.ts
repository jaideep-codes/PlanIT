import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  LoginRequest,
  OtpResendRequest,
  OtpVerifyRequest,
  PasswordForgotRequest,
  PasswordResetRequest,
  SignupRequest,
} from '@planit/shared';
import { ERROR_CODES } from '@planit/shared';
import type { AuthSessionList, SessionRevocation } from '@planit/types';

import { AppException } from '../../common/errors/app.exception.js';
import { RateLimitedException } from '../../common/errors/rate-limited.exception.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import {
  AUDIT_ACTIONS,
  INVALID_CODE_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  OTP_ATTEMPTS_MESSAGE,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MESSAGE,
  RESEND_HOURLY_MESSAGE,
  SESSION_ENDED_MESSAGE,
  VERIFY_EMAIL_MESSAGE,
} from './auth.constants.js';
import type { AuthUser } from './auth.repository.js';
import { AuthRepository } from './auth.repository.js';
import { sha256Hex } from './crypto.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import type { RequestMeta } from './request-meta.js';
import type { IssuedSession } from './session.service.js';
import { SessionService } from './session.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly accounts: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly otps: OtpService,
    private readonly sessions: SessionService,
    private readonly limits: AuthRateLimitService,
    private readonly audit: AuditService,
  ) {}

  async signup(
    input: SignupRequest,
    meta: RequestMeta,
  ): Promise<{ status: 'verification_required' }> {
    await this.limits.enforce('signup', { ip: this.ip(meta), email: input.email });
    // Hash and the breach check run before the existence branch so an unknown email
    // costs the same work as a known one. Argon2id dominates the remaining gap.
    const passwordHash = await this.passwords.hash(input.password);
    await this.passwords.assertNotBreached(input.password);

    const existing = await this.accounts.findByEmail(input.email);
    if (existing) {
      await this.continueExistingSignup(existing);
      return { status: 'verification_required' };
    }

    const created = await this.accounts.createAccount(input.email, passwordHash);
    if (created === 'exists') {
      const raced = await this.accounts.findByEmail(input.email);
      if (raced) await this.continueExistingSignup(raced);
      return { status: 'verification_required' };
    }

    await this.audit.record({
      userId: created.id,
      action: AUDIT_ACTIONS.SIGNUP,
      requestId: meta.requestId,
      ip: meta.ip,
    });
    await this.otps.issue(created.id, input.email, 'silent');
    return { status: 'verification_required' };
  }

  async verifyEmail(input: OtpVerifyRequest, meta: RequestMeta): Promise<{ status: 'verified' }> {
    await this.limits.enforce('otpVerify', { ip: this.ip(meta), email: input.email });
    await this.otps.verify(input.email, input.code);
    return { status: 'verified' };
  }

  async resend(
    input: OtpResendRequest,
    meta: RequestMeta,
  ): Promise<{ status: 'verification_required' }> {
    await this.limits.enforce('otpResend', { ip: this.ip(meta), email: input.email });
    const user = await this.accounts.findByEmail(input.email);
    if (!user || user.status !== 'ACTIVE' || user.emailVerifiedAt) {
      this.otps.burn(input.email);
      return { status: 'verification_required' };
    }
    await this.otps.issue(user.id, user.email, 'strict');
    return { status: 'verification_required' };
  }

  /** A mismatch, including a password that would fail signup, is invalid credentials. */
  async login(input: LoginRequest, meta: RequestMeta): Promise<IssuedSession> {
    await this.limits.enforce('login', { ip: this.ip(meta), email: input.email });
    const user = await this.accounts.findByEmail(input.email);
    const passwordOk = await this.passwords.verify(input.password, user?.passwordHash ?? null);

    if (!user || !user.passwordHash || !passwordOk) {
      await this.audit.record({
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        metadata: { reason: 'invalid_credentials' },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      throw new AppException(
        ERROR_CODES.UNAUTHENTICATED,
        INVALID_CREDENTIALS_MESSAGE,
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.status !== 'ACTIVE') {
      await this.audit.record({
        userId: user.id,
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        metadata: { reason: 'inactive' },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      throw new AppException(
        ERROR_CODES.UNAUTHENTICATED,
        INVALID_CREDENTIALS_MESSAGE,
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!user.emailVerifiedAt) {
      await this.audit.record({
        userId: user.id,
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        metadata: { reason: 'unverified' },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      throw new AppException(ERROR_CODES.FORBIDDEN, VERIFY_EMAIL_MESSAGE, HttpStatus.FORBIDDEN);
    }

    return this.sessions.transaction(async (tx) => {
      const issued = await this.sessions.openFamily(tx, user.id, meta);
      await this.audit.record(
        {
          userId: user.id,
          action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
          targetType: 'auth_session',
          targetId: issued.sessionId,
          requestId: meta.requestId,
          ip: meta.ip,
        },
        tx,
      );
      return issued;
    });
  }

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    await this.limits.enforce('refresh', {
      ip: this.ip(meta),
      account: rawToken ? sha256Hex(rawToken) : 'missing',
    });
    if (!rawToken) {
      throw new AppException(
        ERROR_CODES.UNAUTHENTICATED,
        SESSION_ENDED_MESSAGE,
        HttpStatus.UNAUTHORIZED,
      );
    }
    const outcome = await this.sessions.rotate(rawToken, meta);
    if (outcome === 'reuse' || outcome === 'invalid') {
      throw new AppException(
        ERROR_CODES.UNAUTHENTICATED,
        SESSION_ENDED_MESSAGE,
        HttpStatus.UNAUTHORIZED,
      );
    }
    return outcome;
  }

  async logout(cookies: { refresh?: string; access?: string }, meta: RequestMeta): Promise<void> {
    await this.limits.enforce('logout', {
      ip: this.ip(meta),
      account: sha256Hex(cookies.refresh ?? cookies.access ?? 'missing'),
    });
    if (!cookies.refresh && !cookies.access) {
      throw new AppException(
        ERROR_CODES.UNAUTHENTICATED,
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.sessions.revokePresented(cookies, meta);
  }

  /**
   * Always answers the same way. The cooldown and hourly limits are Redis counters keyed
   * by the submitted email, so they do not depend on whether an account exists.
   */
  async requestPasswordReset(
    input: PasswordForgotRequest,
    meta: RequestMeta,
  ): Promise<{ status: 'reset_requested' }> {
    const identity = { ip: this.ip(meta), email: input.email };
    await this.limits.enforce('passwordForgotCooldown', identity, RESEND_COOLDOWN_MESSAGE);
    await this.limits.enforce('passwordForgot', identity, RESEND_HOURLY_MESSAGE);

    const user = await this.accounts.findByEmail(input.email);
    const eligible = user !== null && user.status === 'ACTIVE' && user.passwordHash !== null;
    if (!eligible || !user) {
      this.otps.burn('000000');
      await this.audit.record({
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
        metadata: { delivered: false },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return { status: 'reset_requested' };
    }

    const delivery = await this.otps.issue(user.id, user.email, 'silent', 'PASSWORD_RESET');
    await this.audit.record({
      userId: user.id,
      action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
      metadata: { delivered: delivery === 'sent' },
      requestId: meta.requestId,
      ip: meta.ip,
    });
    return { status: 'reset_requested' };
  }

  async resetPassword(input: PasswordResetRequest, meta: RequestMeta): Promise<void> {
    await this.limits.enforce('passwordReset', { ip: this.ip(meta), email: input.email });
    const matched = await this.otps.matchActive(input.email, input.code, 'PASSWORD_RESET');
    if (matched === 'attempts') {
      throw new RateLimitedException(Math.ceil(OTP_TTL_MS / 1000), OTP_ATTEMPTS_MESSAGE);
    }
    if (matched === 'invalid') {
      throw new AppException(ERROR_CODES.BAD_REQUEST, INVALID_CODE_MESSAGE, HttpStatus.BAD_REQUEST);
    }

    await this.passwords.assertNotBreached(input.password);
    const passwordHash = await this.passwords.hash(input.password);
    const now = new Date();

    await this.sessions.transaction(async (tx) => {
      const consumed = await this.otps.consumeMatching(
        tx,
        input.email,
        input.code,
        'PASSWORD_RESET',
      );
      if (!consumed || consumed.userId !== matched.userId) {
        throw new AppException(
          ERROR_CODES.BAD_REQUEST,
          INVALID_CODE_MESSAGE,
          HttpStatus.BAD_REQUEST,
        );
      }
      const replaced = await this.accounts.replacePassword(tx, consumed.userId, passwordHash, now);
      if (replaced !== 'updated') {
        throw new AppException(
          ERROR_CODES.BAD_REQUEST,
          INVALID_CODE_MESSAGE,
          HttpStatus.BAD_REQUEST,
        );
      }
      const sessionsRevoked = await this.sessions.revokeAllForPasswordReset(
        tx,
        consumed.userId,
        now,
      );
      await this.audit.record(
        {
          userId: consumed.userId,
          action: AUDIT_ACTIONS.PASSWORD_RESET,
          targetType: 'user',
          targetId: consumed.userId,
          metadata: { sessionsRevoked },
          requestId: meta.requestId,
          ip: meta.ip,
        },
        tx,
      );
    });
  }

  async listSessions(userId: string, currentSessionId: string): Promise<AuthSessionList> {
    const rows = await this.sessions.listActive(userId);
    return {
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        userAgent: row.userAgent,
        current: row.id === currentSessionId,
      })),
      nextCursor: null,
    };
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    currentSessionId: string,
    meta: RequestMeta,
  ): Promise<SessionRevocation> {
    const revoked = await this.sessions.revokeOwned(userId, sessionId, meta);
    if (!revoked) {
      throw new AppException(ERROR_CODES.NOT_FOUND, 'Session not found.', HttpStatus.NOT_FOUND);
    }
    return {
      status: 'revoked',
      currentSessionRevoked: sessionId === currentSessionId,
    };
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId: string,
    meta: RequestMeta,
  ): Promise<SessionRevocation> {
    await this.sessions.revokeOthers(userId, currentSessionId, meta);
    return { status: 'revoked', currentSessionRevoked: false };
  }

  private async continueExistingSignup(user: AuthUser): Promise<void> {
    if (user.status === 'ACTIVE' && !user.emailVerifiedAt) {
      await this.otps.issue(user.id, user.email, 'silent');
    }
  }

  private ip(meta: RequestMeta): string {
    return meta.ip && meta.ip.length > 0 ? meta.ip : 'unknown';
  }
}
