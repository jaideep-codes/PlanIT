import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { otpDeletionCutoff } from './otp-retention.js';
import { OtpRepository } from './otp.repository.js';

@Injectable()
export class OtpMaintenanceService {
  constructor(
    private readonly otps: OtpRepository,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(OtpMaintenanceService.name);
  }

  async deleteExpired(now = new Date()): Promise<number> {
    const deleted = await this.otps.deleteExpiredBefore(otpDeletionCutoff(now));
    this.logger.info({ deleted, queue: 'maintenance' }, 'Deleted expired OTP rows');
    return deleted;
  }
}
