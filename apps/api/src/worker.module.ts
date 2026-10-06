import { Module } from '@nestjs/common';

import { LoggingModule } from './common/logging/logging.module.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { MailModule } from './infrastructure/mail/mail.module.js';
import { OtpMaintenanceService } from './modules/auth/otp-maintenance.service.js';
import { OtpRepository } from './modules/auth/otp.repository.js';
import { RecurringTasksModule } from './modules/recurring-tasks/recurring-tasks.module.js';
import { EmailProcessor } from './worker/email.processor.js';
import { OtpCleanupProcessor } from './worker/otp-cleanup.processor.js';
import { RecurrenceProcessor } from './worker/recurrence.processor.js';

/** Job processors only. The HTTP server, session guard, and request throttler are not started. */
@Module({
  imports: [AppConfigModule, LoggingModule, DatabaseModule, MailModule, RecurringTasksModule],
  providers: [
    OtpRepository,
    OtpMaintenanceService,
    EmailProcessor,
    OtpCleanupProcessor,
    RecurrenceProcessor,
  ],
})
export class WorkerModule {}
