import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { SystemClock } from './clock.js';
import { RecurringTasksController } from './recurring-tasks.controller.js';
import { RecurringTasksRepository } from './recurring-tasks.repository.js';
import { RecurringTasksService } from './recurring-tasks.service.js';

@Module({
  imports: [AuditModule, TasksModule],
  controllers: [RecurringTasksController],
  providers: [RecurringTasksRepository, RecurringTasksService, SystemClock],
  exports: [RecurringTasksService],
})
export class RecurringTasksModule {}
