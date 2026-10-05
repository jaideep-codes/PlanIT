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
  createTaskRequestSchema,
  emptyRequestSchema,
  listTasksQuerySchema,
  repositionTaskRequestSchema,
  taskIdSchema,
  updateTaskRequestSchema,
  type CreateTaskRequest,
  type ListTasksQuery,
  type RepositionTaskRequest,
  type UpdateTaskRequest,
} from '@planit/shared';
import type { Task, TaskList } from '@planit/types';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import {
  CurrentUser as CurrentUserParam,
  type AuthenticatedUser,
} from '../auth/current-user.decorator.js';
import { requestMeta } from '../auth/request-meta.js';
import { TasksService } from './tasks.service.js';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUserParam() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTaskRequestSchema)) body: CreateTaskRequest,
  ): Promise<Task> {
    return this.tasks.create(user.id, body);
  }

  @Get()
  list(
    @CurrentUserParam() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listTasksQuerySchema)) query: ListTasksQuery,
  ): Promise<TaskList> {
    return this.tasks.list(user.id, query);
  }

  @Get(':id')
  get(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdSchema)) id: string,
  ): Promise<Task> {
    return this.tasks.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateTaskRequestSchema)) body: UpdateTaskRequest,
  ): Promise<Task> {
    return this.tasks.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdSchema)) id: string,
    @Req() req: Request,
  ): Promise<Task> {
    return this.tasks.delete(user.id, id, requestMeta(req));
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdSchema)) id: string,
    @Body(new ZodValidationPipe(emptyRequestSchema)) _body: Record<string, never>,
    @Req() req: Request,
  ): Promise<Task> {
    return this.tasks.complete(user.id, id, requestMeta(req));
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdSchema)) id: string,
    @Body(new ZodValidationPipe(emptyRequestSchema)) _body: Record<string, never>,
    @Req() req: Request,
  ): Promise<Task> {
    return this.tasks.reopen(user.id, id, requestMeta(req));
  }

  @Patch(':id/position')
  reposition(
    @CurrentUserParam() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdSchema)) id: string,
    @Body(new ZodValidationPipe(repositionTaskRequestSchema)) body: RepositionTaskRequest,
  ): Promise<Task> {
    return this.tasks.reposition(user.id, id, body);
  }
}
