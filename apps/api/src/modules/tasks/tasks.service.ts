import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@planit/shared';
import type {
  CreateTaskRequest,
  ListTasksQuery,
  RepositionTaskRequest,
  UpdateTaskRequest,
} from '@planit/shared';
import type { Task, TaskList, TaskStatus } from '@planit/types';

import { AppException } from '../../common/errors/app.exception.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../auth/request-meta.js';
import { between, FractionalIndexExhaustedError } from './fractional-index.js';
import { BadTaskCursorError, decodeTaskCursor, encodeTaskCursor } from './task-cursor.js';
import { compareManual, parseSort, preferenceToSort, type TaskListFilters } from './task-query.js';
import {
  TasksRepository,
  type ManualAnchor,
  type TaskFieldPatch,
  type TaskWrite,
} from './tasks.repository.js';

const TASK_AUDIT = {
  COMPLETED: 'task.completed',
  REOPENED: 'task.reopened',
  DELETED: 'task.deleted',
} as const;

function notFound(): AppException {
  return new AppException(ERROR_CODES.NOT_FOUND, 'Task not found.', HttpStatus.NOT_FOUND);
}

function badRequest(message: string): AppException {
  return new AppException(ERROR_CODES.BAD_REQUEST, message, HttpStatus.BAD_REQUEST);
}

function conflict(message: string): AppException {
  return new AppException(ERROR_CODES.CONFLICT, message, HttpStatus.CONFLICT);
}

function sorted<T extends string>(values: readonly T[] | undefined): T[] | undefined {
  return values === undefined ? undefined : [...values].sort();
}

function filtersOf(query: ListTasksQuery): TaskListFilters {
  return {
    ...(query.status !== undefined ? { status: sorted(query.status) } : {}),
    ...(query.priority !== undefined ? { priority: sorted(query.priority) } : {}),
    ...(query.due !== undefined ? { due: query.due } : {}),
    ...(query.scheduledFrom !== undefined ? { scheduledFrom: query.scheduledFrom } : {}),
    ...(query.scheduledTo !== undefined ? { scheduledTo: query.scheduledTo } : {}),
  };
}

function toPatch(input: UpdateTaskRequest): TaskFieldPatch {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    ...(input.scheduledStart !== undefined
      ? { scheduledStart: input.scheduledStart === null ? null : new Date(input.scheduledStart) }
      : {}),
    ...(input.scheduledEnd !== undefined
      ? { scheduledEnd: input.scheduledEnd === null ? null : new Date(input.scheduledEnd) }
      : {}),
    ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };
}

@Injectable()
export class TasksService {
  constructor(
    private readonly tasks: TasksRepository,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, input: CreateTaskRequest): Promise<Task> {
    return this.tasks.transaction(async (tx) => {
      await this.tasks.lockUser(userId, tx);
      const lowest = await this.tasks.lowestSortOrder(userId, tx);
      const row = await this.tasks.create(
        userId,
        {
          title: input.title,
          notes: input.notes ?? null,
          priority: input.priority ?? 'MEDIUM',
          dueDate: input.dueDate ?? null,
          scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : null,
          scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : null,
          estimatedMinutes: input.estimatedMinutes ?? null,
          sortOrder: this.orderKey(null, lowest),
        },
        tx,
      );
      return row;
    });
  }

  async list(userId: string, query: ListTasksQuery): Promise<TaskList> {
    const sort = query.sort
      ? parseSort(query.sort)
      : preferenceToSort(await this.tasks.defaultSort(userId));
    const filters = filtersOf(query);
    const cursor = query.cursor === undefined ? null : this.cursor(query.cursor, filters, sort);
    const rows = await this.tasks.page(userId, {
      take: query.limit + 1,
      filters,
      sort,
      cursor,
    });
    const items = rows.slice(0, query.limit);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeTaskCursor(last, filters, sort)
          : null,
    };
  }

  async get(userId: string, taskId: string): Promise<Task> {
    return this.require(await this.tasks.findById(userId, taskId));
  }

  async update(userId: string, taskId: string, input: UpdateTaskRequest): Promise<Task> {
    return this.require(await this.tasks.update(userId, taskId, toPatch(input)));
  }

  /** Hard-deletes the task and returns it. The response status is 200. */
  async delete(userId: string, taskId: string, meta: RequestMeta): Promise<Task> {
    return this.tasks.transaction(async (tx) => {
      const existing = await this.tasks.lockTask(userId, taskId, tx);
      if (!existing) throw notFound();
      if (existing.recurringTaskId) {
        await this.tasks.skipLinkedOccurrence(userId, taskId, tx);
      }
      const removed = await this.tasks.delete(userId, taskId, tx);
      if (!removed) throw notFound();
      await this.record(userId, TASK_AUDIT.DELETED, taskId, {}, meta, tx);
      return existing;
    });
  }

  /**
   * Sets COMPLETED and the server clock. A task that is already completed is
   * returned unchanged and is not audited again.
   */
  async complete(userId: string, taskId: string, meta: RequestMeta): Promise<Task> {
    return this.tasks.transaction(async (tx) => {
      const existing = await this.tasks.lockTask(userId, taskId, tx);
      if (!existing) throw notFound();
      if (existing.status === 'COMPLETED') return existing;
      const previousStatus: TaskStatus = existing.status;
      const updated = await this.tasks.complete(userId, taskId, new Date(), tx);
      if (!updated) return existing;
      if (existing.recurringTaskId) {
        await this.tasks.setLinkedOccurrenceStatus(userId, taskId, 'COMPLETED', tx);
      }
      await this.record(userId, TASK_AUDIT.COMPLETED, taskId, { previousStatus }, meta, tx);
      return updated;
    });
  }

  /** Only a completed task can be reopened. It returns to TODO with no completedAt. */
  async reopen(userId: string, taskId: string, meta: RequestMeta): Promise<Task> {
    return this.tasks.transaction(async (tx) => {
      const existing = await this.tasks.lockTask(userId, taskId, tx);
      if (!existing) throw notFound();
      if (existing.status !== 'COMPLETED') {
        throw conflict('Only a completed task can be reopened.');
      }
      const updated = await this.tasks.reopen(userId, taskId, tx);
      if (!updated) throw conflict('Only a completed task can be reopened.');
      if (existing.recurringTaskId) {
        await this.tasks.setLinkedOccurrenceStatus(userId, taskId, 'MATERIALIZED', tx);
      }
      await this.record(userId, TASK_AUDIT.REOPENED, taskId, {}, meta, tx);
      return updated;
    });
  }

  async reposition(userId: string, taskId: string, input: RepositionTaskRequest): Promise<Task> {
    return this.tasks.transaction(async (tx) => {
      await this.tasks.lockUser(userId, tx);
      const task = await this.tasks.lockTask(userId, taskId, tx);
      if (!task) throw notFound();
      if (input.beforeId === taskId || input.afterId === taskId) {
        throw badRequest('A task cannot be positioned relative to itself.');
      }

      const before = await this.neighbor(userId, input.beforeId, tx);
      const after = await this.neighbor(userId, input.afterId, tx);
      const bounds = await this.bounds(userId, taskId, before, after, tx);
      const updated = await this.tasks.setSortOrder(
        userId,
        taskId,
        this.orderKey(bounds.lower, bounds.upper),
        tx,
      );
      return this.require(updated);
    });
  }

  private async neighbor(
    userId: string,
    taskId: string | undefined,
    tx: DbClient,
  ): Promise<ManualAnchor | null> {
    if (taskId === undefined) return null;
    const task = await this.tasks.findById(userId, taskId, tx);
    if (!task) throw notFound();
    return { id: task.id, sortOrder: task.sortOrder };
  }

  private async bounds(
    userId: string,
    taskId: string,
    before: ManualAnchor | null,
    after: ManualAnchor | null,
    tx: DbClient,
  ): Promise<{ lower: string | null; upper: string | null }> {
    if (before && after) {
      if (compareManual(before, after) >= 0) {
        throw badRequest('beforeId must sort before afterId.');
      }
      const blocked = await this.tasks.hasTaskBetween(userId, before, after, taskId, tx);
      if (blocked) throw badRequest('beforeId and afterId must already be next to each other.');
      return { lower: before.sortOrder, upper: after.sortOrder };
    }
    if (before) {
      const next = await this.tasks.nextManual(userId, before, taskId, tx);
      return { lower: before.sortOrder, upper: next?.sortOrder ?? null };
    }
    if (after) {
      const previous = await this.tasks.previousManual(userId, after, taskId, tx);
      return { lower: previous?.sortOrder ?? null, upper: after.sortOrder };
    }
    throw badRequest('Provide beforeId, afterId, or both.');
  }

  private orderKey(lower: string | null, upper: string | null): string {
    try {
      return between(lower, upper);
    } catch (error) {
      if (error instanceof FractionalIndexExhaustedError) {
        throw conflict('There is no room left between these tasks.');
      }
      throw error;
    }
  }

  private cursor(
    cursor: string,
    filters: TaskListFilters,
    sort: ReturnType<typeof parseSort>,
  ): ReturnType<typeof decodeTaskCursor> {
    try {
      return decodeTaskCursor(cursor, filters, sort);
    } catch (error) {
      if (error instanceof BadTaskCursorError) {
        throw badRequest('The cursor is invalid.');
      }
      throw error;
    }
  }

  /** Recurrence materialization writes tasks through this service, not the tasks repository. */
  lockOwner(userId: string, tx: DbClient): Promise<void> {
    return this.tasks.lockUser(userId, tx);
  }

  lowestSortOrder(userId: string, tx: DbClient): Promise<string | null> {
    return this.tasks.lowestSortOrder(userId, tx);
  }

  createGenerated(
    userId: string,
    write: TaskWrite & { recurringTaskId: string },
    tx: DbClient,
  ): Promise<Task> {
    return this.tasks.create(userId, write, tx);
  }

  lockTask(userId: string, taskId: string, tx: DbClient): Promise<Task | null> {
    return this.tasks.lockTask(userId, taskId, tx);
  }

  updateWithin(
    userId: string,
    taskId: string,
    input: UpdateTaskRequest,
    tx: DbClient,
  ): Promise<Task | null> {
    return this.tasks.update(userId, taskId, toPatch(input), tx);
  }

  deleteWithin(userId: string, taskId: string, tx: DbClient): Promise<boolean> {
    return this.tasks.delete(userId, taskId, tx);
  }

  clearRecurringLink(userId: string, taskId: string, tx: DbClient): Promise<Task | null> {
    return this.tasks.clearRecurringTaskId(userId, taskId, tx);
  }

  deleteOpenForSeries(userId: string, seriesId: string, tx: DbClient): Promise<void> {
    return this.tasks.deleteOpenForSeries(userId, seriesId, tx);
  }

  detachCompletedForSeries(userId: string, seriesId: string, tx: DbClient): Promise<void> {
    return this.tasks.detachCompletedForSeries(userId, seriesId, tx);
  }

  private require(task: Task | null): Task {
    if (!task) throw notFound();
    return task;
  }

  private record(
    userId: string,
    action: (typeof TASK_AUDIT)[keyof typeof TASK_AUDIT],
    taskId: string,
    metadata: { previousStatus?: TaskStatus },
    meta: RequestMeta,
    tx: DbClient,
  ): Promise<void> {
    return this.audit.record(
      {
        userId,
        action,
        targetType: 'task',
        targetId: taskId,
        metadata,
        requestId: meta.requestId,
        ip: meta.ip,
      },
      tx,
    );
  }
}
