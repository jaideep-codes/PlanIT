import { Injectable } from '@nestjs/common';

import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export type OtpPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

export interface OtpRow {
  id: string;
  userId: string | null;
  codeHash: string;
  attempts: number;
  consumedAt: Date | null;
}

@Injectable()
export class OtpRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  latest(email: string, purpose: OtpPurpose): Promise<{ createdAt: Date } | null> {
    return this.prisma.emailOtp.findFirst({
      where: { email, purpose },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
  }

  countSince(email: string, purpose: OtpPurpose, since: Date): Promise<number> {
    return this.prisma.emailOtp.count({
      where: { email, purpose, createdAt: { gte: since } },
    });
  }

  /** Consumes any still-open code for this email and purpose, then stores a new hash. */
  async createActive(input: {
    userId: string;
    email: string;
    purpose: OtpPurpose;
    codeHash: string;
    expiresAt: Date;
  }): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.emailOtp.updateMany({
        where: { email: input.email, purpose: input.purpose, consumedAt: null },
        data: { consumedAt: now },
      });
      return tx.emailOtp.create({
        data: {
          userId: input.userId,
          email: input.email,
          purpose: input.purpose,
          codeHash: input.codeHash,
          expiresAt: input.expiresAt,
        },
        select: { id: true },
      });
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.emailOtp.deleteMany({ where: { id } });
  }

  async lockActive(tx: DbClient, email: string, purpose: OtpPurpose): Promise<OtpRow | null> {
    const existing = await tx.emailOtp.findFirst({
      where: { email, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!existing) return null;
    await tx.$queryRaw`SELECT id FROM email_otps WHERE id = ${existing.id}::uuid FOR UPDATE`;
    return tx.emailOtp.findUnique({
      where: { id: existing.id },
      select: { id: true, userId: true, codeHash: true, attempts: true, consumedAt: true },
    });
  }

  async setAttempts(tx: DbClient, id: string, attempts: number): Promise<void> {
    await tx.emailOtp.update({ where: { id }, data: { attempts } });
  }

  async consume(tx: DbClient, id: string, at: Date): Promise<void> {
    await tx.emailOtp.update({ where: { id }, data: { consumedAt: at } });
  }

  /** Deletes rows whose expiry is at or before `cutoff` (expiry plus the retention window). */
  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const result = await this.prisma.emailOtp.deleteMany({
      where: { expiresAt: { lte: cutoff } },
    });
    return result.count;
  }
}
