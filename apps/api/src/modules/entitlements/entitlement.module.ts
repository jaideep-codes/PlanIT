import { Module } from '@nestjs/common';

import { EntitlementRepository } from './entitlement.repository.js';
import { EntitlementService } from './entitlement.service.js';

@Module({
  providers: [EntitlementRepository, EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementModule {}
