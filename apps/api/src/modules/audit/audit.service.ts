import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../generated/prisma/client.js';

import type { Env } from '../../config/env.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { hashIp } from '../auth/crypto.js';
import { AuditRepository } from './audit.repository.js';

export interface AuditWrite {
  userId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonObject;
  requestId?: string | undefined;
  ip?: string | undefined;
}

@Injectable()
export class AuditService {
  private readonly pepper: Buffer;

  constructor(
    config: ConfigService<Env, true>,
    private readonly audit: AuditRepository,
  ) {
    this.pepper = Buffer.from(config.get('OTP_PEPPER', { infer: true }), 'base64');
  }

  async record(event: AuditWrite, tx?: DbClient): Promise<void> {
    const requestId =
      event.requestId !== undefined && /^[A-Za-z0-9._-]{8,128}$/.test(event.requestId)
        ? event.requestId
        : null;
    await this.audit.append(
      {
        userId: event.userId,
        actorType: 'USER',
        action: event.action,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        metadata: event.metadata ?? {},
        requestId,
        ipHash: event.ip ? hashIp(this.pepper, event.ip) : null,
      },
      tx,
    );
  }
}
