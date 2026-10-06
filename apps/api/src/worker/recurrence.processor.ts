import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { RecurringTasksService } from '../modules/recurring-tasks/recurring-tasks.service.js';

@Injectable()
export class RecurrenceProcessor {
  constructor(
    private readonly recurring: RecurringTasksService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(RecurrenceProcessor.name);
  }

  async process(): Promise<void> {
    const failed = await this.recurring.materializeEnabled();
    if (failed.length === 0) return;
    this.logger.error(
      { recurringTaskIds: failed, queue: 'maintenance' },
      'Recurrence materialization failed',
    );
    throw new Error('Recurrence materialization failed');
  }
}
