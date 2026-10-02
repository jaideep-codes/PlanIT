import { Injectable } from '@nestjs/common';

import { EntitlementRepository } from './entitlement.repository.js';

/** Capabilities checked through this service. Pro features are not built in this phase. */
export const ENTITLEMENTS = {
  PRO: 'pro',
} as const;

export type Entitlement = (typeof ENTITLEMENTS)[keyof typeof ENTITLEMENTS];

@Injectable()
export class EntitlementService {
  constructor(private readonly plans: EntitlementRepository) {}

  async can(userId: string, capability: Entitlement): Promise<boolean> {
    const plan = await this.plans.findByUserId(userId);
    if (!plan) return false;
    if (plan.validUntil !== null && plan.validUntil.getTime() <= Date.now()) return false;
    if (capability === ENTITLEMENTS.PRO) return plan.plan === 'PRO';
    return false;
  }
}
