import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export interface PlanRecord {
  plan: 'FREE' | 'PRO';
  validUntil: Date | null;
}

@Injectable()
export class EntitlementRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: string): Promise<PlanRecord | null> {
    return this.prisma.userPlan.findUnique({
      where: { userId },
      select: { plan: true, validUntil: true },
    });
  }
}
