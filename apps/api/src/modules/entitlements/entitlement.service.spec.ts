import { describe, expect, it } from 'vitest';

import type { EntitlementRepository, PlanRecord } from './entitlement.repository.js';
import { ENTITLEMENTS, EntitlementService } from './entitlement.service.js';

function service(plan: PlanRecord | null) {
  const plans = { findByUserId: () => Promise.resolve(plan) } as unknown as EntitlementRepository;
  return new EntitlementService(plans);
}

describe('EntitlementService', () => {
  it('reads the plan and does not grant Pro to a free account', async () => {
    const entitlements = service({ plan: 'FREE', validUntil: null });
    await expect(entitlements.can('user-1', ENTITLEMENTS.PRO)).resolves.toBe(false);
  });

  it('grants Pro only while the plan is current', async () => {
    const current = service({ plan: 'PRO', validUntil: new Date(Date.now() + 60_000) });
    const expired = service({ plan: 'PRO', validUntil: new Date(Date.now() - 60_000) });
    await expect(current.can('user-1', ENTITLEMENTS.PRO)).resolves.toBe(true);
    await expect(expired.can('user-1', ENTITLEMENTS.PRO)).resolves.toBe(false);
  });
});
