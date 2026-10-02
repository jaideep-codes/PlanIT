import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES, googleCallbackQuerySchema } from '@planit/shared';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { AppException } from '../../common/errors/app.exception.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import {
  AUDIT_ACTIONS,
  AUTH_UNAVAILABLE_MESSAGE,
  GOOGLE_FAILED_MESSAGE,
  GOOGLE_UNAVAILABLE_MESSAGE,
  GOOGLE_UNVERIFIED_ACCOUNT_MESSAGE,
  GOOGLE_UNVERIFIED_EMAIL_MESSAGE,
} from './auth.constants.js';
import type { AuthUser } from './auth.repository.js';
import { AuthRepository, isUniqueViolation } from './auth.repository.js';
import { sha256Hex } from './crypto.js';
import {
  googleAuthorizationUrl,
  oauthStateCookieMatches,
  pkceS256,
  randomOAuthSecret,
} from './google-oauth.crypto.js';
import { GOOGLE_IDENTITY_EXCHANGE, type GoogleIdentityExchange } from './google-oauth.client.js';
import { GOOGLE_OAUTH_SETTINGS, type GoogleOAuthSettings } from './google-oauth.settings.js';
import { GOOGLE_OAUTH_STATE_STORE, type GoogleOAuthStateStore } from './google-oauth.state.js';
import {
  GoogleExchangeUnavailable,
  GoogleTokenRejected,
  type GoogleIdentity,
} from './google-oauth.types.js';
import type { RequestMeta } from './request-meta.js';
import type { IssuedSession } from './session.service.js';
import { SessionService } from './session.service.js';

export type GoogleFailureReason = 'failed' | 'unverified_email' | 'verify_email';

type GoogleOutcome = 'created' | 'linked' | 'signed_in';

type GoogleFailure =
  'invalid_state' | 'denied' | 'rejected' | 'unverified_email' | 'unverified_account' | 'inactive';

const PROVIDER_ERRORS = new Set([
  'access_denied',
  'invalid_request',
  'unauthorized_client',
  'server_error',
  'temporarily_unavailable',
]);

export interface GoogleAuthorization {
  url: string;
  /** SHA-256 hex of the state. This is the value stored in the state cookie. */
  stateHash: string;
}

/** Browser-facing Google failure. The controller redirects; the message is also safe as JSON. */
export class GoogleSignInException extends AppException {
  readonly reason: GoogleFailureReason;

  constructor(reason: GoogleFailureReason, code: string, message: string, status: HttpStatus) {
    super(code, message, status);
    this.reason = reason;
  }
}

function googleFailure(reason: GoogleFailureReason): GoogleSignInException {
  if (reason === 'unverified_email') {
    return new GoogleSignInException(
      reason,
      ERROR_CODES.FORBIDDEN,
      GOOGLE_UNVERIFIED_EMAIL_MESSAGE,
      HttpStatus.FORBIDDEN,
    );
  }
  if (reason === 'verify_email') {
    return new GoogleSignInException(
      reason,
      ERROR_CODES.FORBIDDEN,
      GOOGLE_UNVERIFIED_ACCOUNT_MESSAGE,
      HttpStatus.FORBIDDEN,
    );
  }
  return new GoogleSignInException(
    reason,
    ERROR_CODES.UNAUTHENTICATED,
    GOOGLE_FAILED_MESSAGE,
    HttpStatus.UNAUTHORIZED,
  );
}

function unavailable(): AppException {
  return new AppException(
    ERROR_CODES.SERVICE_UNAVAILABLE,
    GOOGLE_UNAVAILABLE_MESSAGE,
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function normalizeGoogleEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const parsed = z.email().max(320).safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function isGoogleSubject(subject: string): boolean {
  return subject.length > 0 && subject.length <= 255 && !hasControlOrSpace(subject);
}

function displayNameFromGoogle(name: string | null): string | null {
  if (!name) return null;
  let cleaned = '';
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 31 && code !== 127) cleaned += char;
  }
  cleaned = cleaned.trim();
  if (!cleaned) return null;
  const chars = Array.from(cleaned);
  return chars.length <= 50 ? cleaned : chars.slice(0, 50).join('');
}

function hasControlOrSpace(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127 || char.trim() === '') return true;
  }
  return false;
}

function allowedProviderError(value: string): string {
  return PROVIDER_ERRORS.has(value) ? value : 'unknown';
}

@Injectable()
export class GoogleOAuthService {
  constructor(
    @Inject(GOOGLE_OAUTH_SETTINGS) private readonly settings: GoogleOAuthSettings,
    @Inject(GOOGLE_OAUTH_STATE_STORE) private readonly states: GoogleOAuthStateStore,
    @Inject(GOOGLE_IDENTITY_EXCHANGE) private readonly google: GoogleIdentityExchange,
    private readonly accounts: AuthRepository,
    private readonly sessions: SessionService,
    private readonly limits: AuthRateLimitService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(GoogleOAuthService.name);
  }

  isConfigured(): boolean {
    return this.settings.configured;
  }

  successUrl(): string {
    return `${this.settings.webOrigin}/`;
  }

  failureUrl(reason: GoogleFailureReason): string {
    return `${this.settings.webOrigin}/login?google=${reason}`;
  }

  async begin(meta: RequestMeta): Promise<GoogleAuthorization> {
    if (!this.settings.configured) throw unavailable();
    await this.limits.enforce('googleStart', { ip: this.ip(meta) });

    const state = randomOAuthSecret();
    const verifier = randomOAuthSecret();
    const nonce = randomOAuthSecret();
    await this.states.save(state, { verifier, nonce });

    return {
      stateHash: sha256Hex(state),
      url: googleAuthorizationUrl({
        clientId: this.settings.clientId,
        redirectUri: this.settings.redirectUri,
        state,
        nonce,
        codeChallenge: pkceS256(verifier),
      }),
    };
  }

  async complete(
    query: unknown,
    stateCookie: string | undefined,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    if (!this.settings.configured) throw unavailable();
    await this.limits.enforce('googleCallback', { ip: this.ip(meta) });

    const parsed = googleCallbackQuerySchema.safeParse(query);
    if (!parsed.success) {
      await this.fail(null, 'invalid_state', meta);
      throw googleFailure('failed');
    }

    const { code, state, error } = parsed.data;
    if (error) {
      if (state && oauthStateCookieMatches(state, stateCookie)) await this.states.consume(state);
      await this.fail(null, 'denied', meta, allowedProviderError(error));
      throw googleFailure('failed');
    }

    if (!state || !code || !oauthStateCookieMatches(state, stateCookie)) {
      if (state && oauthStateCookieMatches(state, stateCookie)) await this.states.consume(state);
      await this.fail(null, 'invalid_state', meta);
      throw googleFailure('failed');
    }

    const stored = await this.states.consume(state);
    if (!stored) {
      await this.fail(null, 'invalid_state', meta);
      throw googleFailure('failed');
    }

    let identity: GoogleIdentity;
    try {
      identity = await this.google.exchange({
        code,
        codeVerifier: stored.verifier,
        nonce: stored.nonce,
        clientId: this.settings.clientId,
        clientSecret: this.settings.clientSecret,
        redirectUri: this.settings.redirectUri,
      });
    } catch (exchangeError) {
      if (exchangeError instanceof GoogleExchangeUnavailable) {
        this.logger.warn({ reason: 'google_unavailable' }, 'Google sign-in failed');
        await this.fail(null, 'rejected', meta);
        throw new AppException(
          ERROR_CODES.SERVICE_UNAVAILABLE,
          AUTH_UNAVAILABLE_MESSAGE,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      const reason =
        exchangeError instanceof GoogleTokenRejected && exchangeError.reason === 'unverified_email'
          ? 'unverified_email'
          : 'rejected';
      if (!(exchangeError instanceof GoogleTokenRejected)) {
        this.logger.warn({ reason: 'google_exchange' }, 'Google sign-in failed');
      }
      await this.fail(null, reason, meta);
      throw googleFailure(reason === 'unverified_email' ? 'unverified_email' : 'failed');
    }

    if (identity.emailVerified !== true) {
      await this.fail(null, 'unverified_email', meta);
      throw googleFailure('unverified_email');
    }

    const email = normalizeGoogleEmail(identity.email);
    if (!email || !isGoogleSubject(identity.subject)) {
      await this.fail(null, 'rejected', meta);
      throw googleFailure('failed');
    }

    return this.connectIdentity({ ...identity, email }, meta, 0);
  }

  private async connectIdentity(
    identity: GoogleIdentity,
    meta: RequestMeta,
    attempt: number,
  ): Promise<IssuedSession> {
    const linkedUserId = await this.accounts.findGoogleUserId(identity.subject);
    if (linkedUserId) return this.signInExisting(linkedUserId, meta);

    const user = await this.accounts.findByEmail(identity.email);
    if (user) return this.linkExisting(user, identity, meta);

    try {
      return await this.sessions.transaction(async (tx) => {
        const created = await this.accounts.createGoogleUser(tx, {
          email: identity.email,
          displayName: displayNameFromGoogle(identity.name),
          emailVerifiedAt: new Date(),
          providerAccountId: identity.subject,
        });
        return this.issue(tx, created.id, 'created', meta);
      });
    } catch (error) {
      if (!isUniqueViolation(error) || attempt > 0) {
        if (isUniqueViolation(error)) {
          await this.fail(null, 'rejected', meta);
          throw googleFailure('failed');
        }
        throw error;
      }
      return this.connectIdentity(identity, meta, attempt + 1);
    }
  }

  private async linkExisting(
    user: AuthUser,
    identity: GoogleIdentity,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    if (user.status !== 'ACTIVE') {
      await this.fail(user.id, 'inactive', meta);
      throw googleFailure('failed');
    }
    if (!user.emailVerifiedAt) {
      await this.fail(user.id, 'unverified_account', meta);
      throw googleFailure('verify_email');
    }

    try {
      return await this.sessions.transaction(async (tx) => {
        await this.accounts.linkGoogleAccount(tx, user.id, identity.subject);
        return this.issue(tx, user.id, 'linked', meta);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const owner = await this.accounts.findGoogleUserId(identity.subject);
      if (owner) return this.signInExisting(owner, meta);
      await this.fail(user.id, 'rejected', meta);
      throw googleFailure('failed');
    }
  }

  private async signInExisting(userId: string, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.accounts.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.fail(user?.id ?? null, 'inactive', meta);
      throw googleFailure('failed');
    }
    if (!user.emailVerifiedAt) {
      await this.fail(user.id, 'unverified_account', meta);
      throw googleFailure('verify_email');
    }
    return this.sessions.transaction(async (tx) => this.issue(tx, user.id, 'signed_in', meta));
  }

  private async issue(
    tx: DbClient,
    userId: string,
    outcome: GoogleOutcome,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const issued = await this.sessions.openFamily(tx, userId, meta);
    await this.audit.record(
      {
        userId,
        action: AUDIT_ACTIONS.GOOGLE_LINK_SUCCEEDED,
        targetType: 'user',
        targetId: userId,
        metadata: { provider: 'google', outcome },
        requestId: meta.requestId,
        ip: meta.ip,
      },
      tx,
    );
    return issued;
  }

  private async fail(
    userId: string | null,
    reason: GoogleFailure,
    meta: RequestMeta,
    providerError?: string,
  ): Promise<void> {
    await this.audit.record({
      userId,
      action: AUDIT_ACTIONS.GOOGLE_LINK_FAILED,
      metadata: {
        provider: 'google',
        reason,
        ...(providerError !== undefined ? { providerError } : {}),
      },
      requestId: meta.requestId,
      ip: meta.ip,
    });
  }

  private ip(meta: RequestMeta): string {
    return meta.ip && meta.ip.length > 0 ? meta.ip : 'unknown';
  }
}
