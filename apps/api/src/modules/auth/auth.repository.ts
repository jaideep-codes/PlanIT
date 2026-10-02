import { Injectable } from '@nestjs/common';

import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION';
}

const USER_SELECT = {
  id: true,
  email: true,
  passwordHash: true,
  emailVerifiedAt: true,
  status: true,
} as const;

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({ where: { email }, select: USER_SELECT });
  }

  findById(id: string): Promise<Omit<AuthUser, 'passwordHash'> | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, emailVerifiedAt: true, status: true },
    });
  }

  /**
   * Creates the user, a SYSTEM preference, and a FREE plan. Returns `exists` when the
   * email was inserted concurrently so the caller can take the same path as a repeat signup.
   */
  async createAccount(email: string, passwordHash: string): Promise<{ id: string } | 'exists'> {
    try {
      return await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          preference: { create: { theme: 'SYSTEM' } },
          plan: { create: { plan: 'FREE' } },
        },
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'exists';
      throw error;
    }
  }

  async markEmailVerified(tx: DbClient, userId: string, at: Date): Promise<void> {
    await tx.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: at },
    });
  }

  /**
   * Replaces the password hash. An unverified inbox is marked verified because the reset
   * code already proved the person can read mail sent to it. Returns `rejected` when the
   * account cannot take a password, without exposing that fact to the caller.
   */
  async replacePassword(
    tx: DbClient,
    userId: string,
    passwordHash: string,
    at: Date,
  ): Promise<'updated' | 'rejected'> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true, emailVerifiedAt: true, passwordHash: true },
    });
    if (!user || user.status !== 'ACTIVE' || !user.passwordHash) return 'rejected';
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        emailVerifiedAt: user.emailVerifiedAt ?? at,
      },
    });
    return 'updated';
  }

  /** The PlanIT user already linked to this Google subject, if any. */
  async findGoogleUserId(providerAccountId: string): Promise<string | null> {
    const row = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId } },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }

  /**
   * Google-only account: no password hash, and the email is already verified because Google
   * asserted `email_verified`. Preference and plan match a password signup.
   */
  createGoogleUser(
    tx: DbClient,
    input: {
      email: string;
      displayName: string | null;
      emailVerifiedAt: Date;
      providerAccountId: string;
    },
  ): Promise<{ id: string }> {
    return tx.user.create({
      data: {
        email: input.email,
        passwordHash: null,
        emailVerifiedAt: input.emailVerifiedAt,
        displayName: input.displayName,
        preference: { create: { theme: 'SYSTEM' } },
        plan: { create: { plan: 'FREE' } },
        oauthAccounts: {
          create: { provider: 'GOOGLE', providerAccountId: input.providerAccountId },
        },
      },
      select: { id: true },
    });
  }

  async linkGoogleAccount(tx: DbClient, userId: string, providerAccountId: string): Promise<void> {
    await tx.oAuthAccount.create({
      data: { userId, provider: 'GOOGLE', providerAccountId },
    });
  }
}
