import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createRecurringTaskRequestSchema,
  emptyRequestSchema,
  listRecurringTasksQuerySchema,
  occurrenceDateSchema,
  occurrenceRangeQuerySchema,
  recurringTaskIdSchema,
  updateRecurringTaskRequestSchema,
  updateTaskRequestSchema,
  type CreateRecurringTaskRequest,
  type ListRecurringTasksQuery,
  type OccurrenceRangeQuery,
  type UpdateRecurringTaskRequest,
  type UpdateTaskRequest,
} from '@planit/shared';
import type {
  RecurringTask,
  RecurringTaskList,
  Task,
  TaskOccurrence,
  TaskOccurrenceList,
} from '@planit/types';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import {
  CurrentUser as CurrentUserParam,
  type AuthenticatedUser,
} from '../auth/current-user.decorator.js';
import { requestMeta } from '../auth/request-meta.js';
import { RecurringTasksService } from './recurring-tasks.service.js';

@Controller('recurring-tasks')
export class RecurringTasksController {
  constructor(private readonly series: RecurringTasksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUserParam() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createRecurringTaskRequestSchema)) body: CreateRecurringTaskRequest,
  ): Promise<RecurringTask> {
    return this.series.create(user.id, body);
  }

  @Get()
  list(
    @CurrentUserParam() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listRecurringTasksQuerySchema)) query: ListRecurringTasksQuery,
  ): Promise<RecurringTaskList> {
    return this.series.list(user.id, query);
  }

  @Get(':id/occurrences')
  occurrences(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(recurringTaskIdSchema)) id: string,
    @Query(new ZodValidationPipe(occurrenceRangeQuerySchema)) query: OccurrenceRangeQuery,
  ): Promise<TaskOccurrenceList> {
    return this.series.occurrences(user.id, id, query.from, query.to);
  }

  @Post(':id/occurrences/:date/skip')
  @HttpCode(HttpStatus.OK)
  skip(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(recurringTaskIdSchema)) id: string,
    @Param('date', new ZodValidationPipe(occurrenceDateSchema)) date: string,
    @Body(new ZodValidationPipe(emptyRequestSchema)) _body: Record<string, never>,
    @Req() req: Request,
  ): Promise<TaskOccurrence> {
    return this.series.skip(user.id, id, date, requestMeta(req));
  }

  @Patch(':id/occurrences/:date')
  editOccurrence(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(recurringTaskIdSchema)) id: string,
    @Param('date', new ZodValidationPipe(occurrenceDateSchema)) date: string,
    @Body(new ZodValidationPipe(updateTaskRequestSchema)) body: UpdateTaskRequest,
    @Req() req: Request,
  ): Promise<Task> {
    return this.series.editOccurrence(user.id, id, date, body, requestMeta(req));
  }

  @Get(':id')
  get(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(recurringTaskIdSchema)) id: string,
  ): Promise<RecurringTask> {
    return this.series.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(recurringTaskIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateRecurringTaskRequestSchema)) body: UpdateRecurringTaskRequest,
  ): Promise<RecurringTask> {
    return this.series.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(recurringTaskIdSchema)) id: string,
    @Req() req: Request,
  ): Promise<RecurringTask> {
    return this.series.delete(user.id, id, requestMeta(req));
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  stop(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(recurringTaskIdSchema)) id: string,
    @Body(new ZodValidationPipe(emptyRequestSchema)) _body: Record<string, never>,
    @Req() req: Request,
  ): Promise<RecurringTask> {
    return this.series.stop(user.id, id, requestMeta(req));
  }
}
