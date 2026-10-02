import { Injectable } from '@nestjs/common';

import { OtpMaintenanceService } from '../modules/auth/otp-maintenance.service.js';

@Injectable()
export class OtpCleanupProcessor {
  constructor(private readonly maintenance: OtpMaintenanceService) {}

  process(): Promise<number> {
    return this.maintenance.deleteExpired();
  }
}
