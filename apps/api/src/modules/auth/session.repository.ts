import { Injectable } from '@nestjs/common';

import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export interface SessionRow {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: 'LOGOUT' | 'ROTATED' | 'REUSE' | 'PASSWORD_RESET' | null;
  replacedById: string | null;
}

export interface ActiveSessionRow {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  userAgent: string | null;
}

type UserRevokeReason = 'LOGOUT' | 'PASSWORD_RESET';

const SESSION_SELECT = {
  id: true,
  userId: true,
  familyId: true,
  expiresAt: true,
  revokedAt: true,
  revokedReason: true,
  replacedById: true,
} as const;

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  findById(id: string): Promise<SessionRow | null> {
    return this.prisma.authSession.findUnique({ where: { id }, select: SESSION_SELECT });
  }

  /**
   * Locks the row for the rest of the transaction, then re-reads it so a concurrent
   * rotation is visible before this transaction decides.
   */
  async lockById(tx: DbClient, id: string): Promise<SessionRow | null> {
    await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.authSession.findUnique({ where: { id }, select: SESSION_SELECT });
  }

  async lockByHash(tx: DbClient, refreshTokenHash: string): Promise<SessionRow | null> {
    const existing = await tx.authSession.findUnique({
      where: { refreshTokenHash },
      select: { id: true },
    });
    if (!existing) return null;
    await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${existing.id}::uuid FOR UPDATE`;
    return tx.authSession.findUnique({ where: { id: existing.id }, select: SESSION_SELECT });
  }

  async insert(
    tx: DbClient,
    input: {
      userId: string;
      familyId: string;
      refreshTokenHash: string;
      expiresAt: Date;
      userAgent: string | null;
    },
  ): Promise<{ id: string }> {
    return tx.authSession.create({
      data: {
        userId: input.userId,
        familyId: input.familyId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
      },
      select: { id: true },
    });
  }

  async markRotated(
    tx: DbClient,
    sessionId: string,
    replacedById: string,
    at: Date,
  ): Promise<void> {
    await tx.authSession.update({
      where: { id: sessionId },
      data: { revokedAt: at, revokedReason: 'ROTATED', replacedById, lastUsedAt: at },
    });
  }

  async revokeFamily(tx: DbClient, familyId: string, at: Date): Promise<void> {
    await tx.authSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at, revokedReason: 'REUSE' },
    });
  }

  async revoke(tx: DbClient, sessionId: string, at: Date): Promise<void> {
    await tx.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: at, revokedReason: 'LOGOUT' },
    });
  }

  /** Live sessions for one user. The refresh-token hash is never selected. */
  listActive(userId: string, now: Date): Promise<ActiveSessionRow[]> {
    return this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        userAgent: true,
      },
    });
  }

  /** Revokes one unrevoked session owned by `userId`. Returns 0 when it is not theirs. */
  async revokeOwned(tx: DbClient, userId: string, sessionId: string, at: Date): Promise<number> {
    const result = await tx.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: at, revokedReason: 'LOGOUT' },
    });
    return result.count;
  }

  /**
   * Revokes every unrevoked session for the user. `exceptSessionId` keeps the caller's
   * current session. The reason is LOGOUT for a user action and PASSWORD_RESET after a reset.
   */
  async revokeUnrevoked(
    tx: DbClient,
    userId: string,
    at: Date,
    reason: UserRevokeReason,
    exceptSessionId?: string,
  ): Promise<number> {
    const result = await tx.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId !== undefined ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: at, revokedReason: reason },
    });
    return result.count;
  }
}
