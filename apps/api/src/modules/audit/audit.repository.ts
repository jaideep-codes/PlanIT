import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export interface NewAuditEvent {
  userId: string | null;
  actorType: 'USER' | 'SYSTEM' | 'AI_PROPOSAL';
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Prisma.InputJsonObject;
  requestId: string | null;
  ipHash: string | null;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Insert only. The table rejects updates and deletes. */
  async append(event: NewAuditEvent, tx?: DbClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        userId: event.userId,
        actorType: event.actorType,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        metadata: event.metadata,
        requestId: event.requestId,
        ipHash: event.ipHash,
      },
    });
  }
}
