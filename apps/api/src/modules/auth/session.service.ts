import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { AuditService } from '../audit/audit.service.js';
import { AUDIT_ACTIONS, REFRESH_TTL_SECONDS } from './auth.constants.js';
import { AuthRepository } from './auth.repository.js';
import {
  generateRefreshToken,
  sha256Hex,
  signAccessToken,
  uuidv7,
  verifyAccessToken,
} from './crypto.js';
import { SessionRepository, type ActiveSessionRow } from './session.repository.js';
import type { RequestMeta } from './request-meta.js';

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class SessionService {
  private readonly key: Buffer;

  constructor(
    config: ConfigService<Env, true>,
    private readonly sessions: SessionRepository,
    private readonly accounts: AuthRepository,
    private readonly audit: AuditService,
  ) {
    this.key = Buffer.from(config.get('JWT_SIGNING_KEY', { infer: true }), 'base64');
  }

  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.sessions.transaction(fn);
  }

  /** New family. Login calls this and does not revoke the user's other sessions. */
  async openFamily(tx: DbClient, userId: string, meta: RequestMeta): Promise<IssuedSession> {
    return this.insert(tx, userId, uuidv7(), meta);
  }

  async rotate(rawToken: string, meta: RequestMeta): Promise<IssuedSession | 'reuse' | 'invalid'> {
    const now = new Date();
    return this.sessions.transaction(async (tx) => {
      const current = await this.sessions.lockByHash(tx, sha256Hex(rawToken));
      if (!current) return 'invalid';
      if (current.replacedById !== null || current.revokedReason === 'ROTATED') {
        await this.sessions.revokeFamily(tx, current.familyId, now);
        await this.audit.record(
          {
            userId: current.userId,
            action: AUDIT_ACTIONS.REFRESH_REUSE,
            targetType: 'auth_session',
            targetId: current.id,
            metadata: { familyId: current.familyId },
            requestId: meta.requestId,
            ip: meta.ip,
          },
          tx,
        );
        return 'reuse';
      }
      if (current.revokedAt !== null || current.expiresAt.getTime() <= now.getTime())
        return 'invalid';
      const issued = await this.insert(tx, current.userId, current.familyId, meta);
      await this.sessions.markRotated(tx, current.id, issued.sessionId, now);
      return issued;
    });
  }

  async revokePresented(
    cookies: { refresh?: string; access?: string },
    meta: RequestMeta,
  ): Promise<void> {
    const now = new Date();
    await this.sessions.transaction(async (tx) => {
      if (cookies.refresh) {
        const row = await this.sessions.lockByHash(tx, sha256Hex(cookies.refresh));
        if (row && row.revokedAt === null) {
          await this.revokeActive(tx, row, now, meta);
          return;
        }
      }
      // A rotated refresh cookie must not hide the live access-token session.
      if (!cookies.access) return;
      const claims = verifyAccessToken(this.key, cookies.access);
      if (!claims) return;
      const row = await this.sessions.lockById(tx, claims.sid);
      if (!row || row.userId !== claims.sub || row.revokedAt !== null) return;
      await this.revokeActive(tx, row, now, meta);
    });
  }

  private async revokeActive(
    tx: DbClient,
    row: { id: string; userId: string },
    at: Date,
    meta: RequestMeta,
  ): Promise<void> {
    await this.sessions.revoke(tx, row.id, at);
    await this.audit.record(
      {
        userId: row.userId,
        action: AUDIT_ACTIONS.LOGOUT,
        targetType: 'auth_session',
        targetId: row.id,
        requestId: meta.requestId,
        ip: meta.ip,
      },
      tx,
    );
  }

  listActive(userId: string): Promise<ActiveSessionRow[]> {
    return this.sessions.listActive(userId, new Date());
  }

  /** Returns false when the session is missing, already revoked, or owned by someone else. */
  async revokeOwned(userId: string, sessionId: string, meta: RequestMeta): Promise<boolean> {
    const now = new Date();
    return this.sessions.transaction(async (tx) => {
      const count = await this.sessions.revokeOwned(tx, userId, sessionId, now);
      if (count !== 1) return false;
      await this.audit.record(
        {
          userId,
          action: AUDIT_ACTIONS.SESSION_REVOKED,
          targetType: 'auth_session',
          targetId: sessionId,
          requestId: meta.requestId,
          ip: meta.ip,
        },
        tx,
      );
      return true;
    });
  }

  /** Revokes every unrevoked session except the one presenting this request. */
  async revokeOthers(userId: string, currentSessionId: string, meta: RequestMeta): Promise<number> {
    const now = new Date();
    return this.sessions.transaction(async (tx) => {
      const revokedCount = await this.sessions.revokeUnrevoked(
        tx,
        userId,
        now,
        'LOGOUT',
        currentSessionId,
      );
      await this.audit.record(
        {
          userId,
          action: AUDIT_ACTIONS.SESSIONS_REVOKED,
          metadata: { revokedCount },
          requestId: meta.requestId,
          ip: meta.ip,
        },
        tx,
      );
      return revokedCount;
    });
  }

  revokeAllForPasswordReset(tx: DbClient, userId: string, at: Date): Promise<number> {
    return this.sessions.revokeUnrevoked(tx, userId, at, 'PASSWORD_RESET');
  }

  async authenticate(
    accessToken: string,
  ): Promise<{ userId: string; sessionId: string } | 'unverified' | null> {
    const claims = verifyAccessToken(this.key, accessToken);
    if (!claims) return null;
    const session = await this.sessions.findById(claims.sid);
    if (!session || session.userId !== claims.sub) return null;
    if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) return null;
    const user = await this.accounts.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') return null;
    if (!user.emailVerifiedAt) return 'unverified';
    return { userId: user.id, sessionId: session.id };
  }

  private async insert(
    tx: DbClient,
    userId: string,
    familyId: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const refreshToken = generateRefreshToken();
    const created = await this.sessions.insert(tx, {
      userId,
      familyId,
      refreshTokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      userAgent: meta.userAgent,
    });
    return {
      sessionId: created.id,
      refreshToken,
      accessToken: signAccessToken(this.key, { sub: userId, sid: created.id }),
    };
  }
}
