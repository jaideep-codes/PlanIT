import { Injectable } from '@nestjs/common';
import type { Task, TaskPriority } from '@planit/types';

import type { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { calendarDateToUtc, formatCalendarDate } from './task-dates.js';
import {
  manualBetweenWhere,
  manualNextWhere,
  manualPreviousWhere,
  taskPageOrderBy,
  taskPageWhere,
  type ResolvedTaskSort,
  type StoredTaskSort,
  type TaskListFilters,
  type TaskPageCursor,
} from './task-query.js';

const TASK_SELECT = {
  id: true,
  title: true,
  notes: true,
  priority: true,
  status: true,
  dueDate: true,
  scheduledStart: true,
  scheduledEnd: true,
  estimatedMinutes: true,
  completedAt: true,
  sortOrder: true,
  recurringTaskId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

export interface TaskWrite {
  title: string;
  notes: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  estimatedMinutes: number | null;
  sortOrder: string;
  recurringTaskId?: string | null;
}

export interface TaskFieldPatch {
  title?: string;
  notes?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  estimatedMinutes?: number | null;
  status?: 'TODO' | 'IN_PROGRESS' | 'CANCELLED';
}

export interface ManualAnchor {
  id: string;
  sortOrder: string;
}

export interface TaskPageQuery {
  take: number;
  filters: TaskListFilters;
  sort: ResolvedTaskSort;
  cursor: TaskPageCursor | null;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    status: row.status,
    dueDate: row.dueDate ? formatCalendarDate(row.dueDate) : null,
    scheduledStart: row.scheduledStart ? row.scheduledStart.toISOString() : null,
    scheduledEnd: row.scheduledEnd ? row.scheduledEnd.toISOString() : null,
    estimatedMinutes: row.estimatedMinutes,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    sortOrder: row.sortOrder,
    recurringTaskId: row.recurringTaskId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class TasksRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  /** The caller's saved list order. Missing preference rows use the column default. */
  async defaultSort(userId: string): Promise<StoredTaskSort> {
    const row = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: { defaultTaskSort: true },
    });
    return row?.defaultTaskSort ?? 'MANUAL';
  }

  async page(userId: string, query: TaskPageQuery): Promise<Task[]> {
    const rows = await this.prisma.task.findMany({
      where: taskPageWhere(userId, query.filters, query.sort, query.cursor),
      orderBy: taskPageOrderBy(query.sort),
      take: query.take,
      select: TASK_SELECT,
    });
    return rows.map(toTask);
  }

  async findById(userId: string, taskId: string, tx?: DbClient): Promise<Task | null> {
    const row = await (tx ?? this.prisma).task.findFirst({
      where: { id: taskId, userId },
      select: TASK_SELECT,
    });
    return row ? toTask(row) : null;
  }

  /** Serializes manual-order changes for one owner. */
  async lockUser(userId: string, tx: DbClient): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }

  async lockTask(userId: string, taskId: string, tx: DbClient): Promise<Task | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM tasks WHERE id = ${taskId}::uuid AND user_id = ${userId}::uuid FOR UPDATE
    `;
    if (rows.length === 0) return null;
    return this.findById(userId, taskId, tx);
  }

  async lowestSortOrder(userId: string, tx: DbClient): Promise<string | null> {
    const row = await tx.task.findFirst({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { sortOrder: true },
    });
    return row?.sortOrder ?? null;
  }

  async create(userId: string, write: TaskWrite, tx: DbClient): Promise<Task> {
    const row = await tx.task.create({
      data: {
        userId,
        title: write.title,
        notes: write.notes,
        priority: write.priority,
        status: 'TODO',
        dueDate: write.dueDate === null ? null : calendarDateToUtc(write.dueDate),
        scheduledStart: write.scheduledStart,
        scheduledEnd: write.scheduledEnd,
        estimatedMinutes: write.estimatedMinutes,
        completedAt: null,
        sortOrder: write.sortOrder,
        recurringTaskId: write.recurringTaskId ?? null,
      },
      select: TASK_SELECT,
    });
    return toTask(row);
  }

  async update(
    userId: string,
    taskId: string,
    patch: TaskFieldPatch,
    tx?: DbClient,
  ): Promise<Task | null> {
    const db = tx ?? this.prisma;
    const result = await db.task.updateMany({
      where: { id: taskId, userId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.dueDate !== undefined
          ? { dueDate: patch.dueDate === null ? null : calendarDateToUtc(patch.dueDate) }
          : {}),
        ...(patch.scheduledStart !== undefined ? { scheduledStart: patch.scheduledStart } : {}),
        ...(patch.scheduledEnd !== undefined ? { scheduledEnd: patch.scheduledEnd } : {}),
        ...(patch.estimatedMinutes !== undefined
          ? { estimatedMinutes: patch.estimatedMinutes }
          : {}),
        ...(patch.status !== undefined ? { status: patch.status, completedAt: null } : {}),
      },
    });
    if (result.count === 0) return null;
    return this.findById(userId, taskId, tx);
  }

  async setLinkedOccurrenceStatus(
    userId: string,
    taskId: string,
    status: 'COMPLETED' | 'MATERIALIZED',
    tx: DbClient,
  ): Promise<void> {
    await tx.taskOccurrence.updateMany({
      where: { userId, taskId },
      data: { status },
    });
  }

  /** Keeps the occurrence row so the daily job does not create the date again. */
  async skipLinkedOccurrence(userId: string, taskId: string, tx: DbClient): Promise<void> {
    await tx.taskOccurrence.updateMany({
      where: { userId, taskId },
      data: { status: 'SKIPPED', taskId: null },
    });
  }

  async clearRecurringTaskId(userId: string, taskId: string, tx: DbClient): Promise<Task | null> {
    const result = await tx.task.updateMany({
      where: { id: taskId, userId },
      data: { recurringTaskId: null },
    });
    if (result.count === 0) return null;
    return this.findById(userId, taskId, tx);
  }

  async deleteOpenForSeries(userId: string, seriesId: string, tx: DbClient): Promise<void> {
    await tx.task.deleteMany({
      where: { userId, recurringTaskId: seriesId, status: { not: 'COMPLETED' } },
    });
  }

  async detachCompletedForSeries(userId: string, seriesId: string, tx: DbClient): Promise<void> {
    await tx.task.updateMany({
      where: { userId, recurringTaskId: seriesId, status: 'COMPLETED' },
      data: { recurringTaskId: null },
    });
  }

  async delete(userId: string, taskId: string, tx: DbClient): Promise<boolean> {
    const result = await tx.task.deleteMany({ where: { id: taskId, userId } });
    return result.count > 0;
  }

  async complete(
    userId: string,
    taskId: string,
    completedAt: Date,
    tx: DbClient,
  ): Promise<Task | null> {
    const result = await tx.task.updateMany({
      where: { id: taskId, userId, status: { not: 'COMPLETED' } },
      data: { status: 'COMPLETED', completedAt },
    });
    if (result.count === 0) return null;
    return this.findById(userId, taskId, tx);
  }

  async reopen(userId: string, taskId: string, tx: DbClient): Promise<Task | null> {
    const result = await tx.task.updateMany({
      where: { id: taskId, userId, status: 'COMPLETED' },
      data: { status: 'TODO', completedAt: null },
    });
    if (result.count === 0) return null;
    return this.findById(userId, taskId, tx);
  }

  async setSortOrder(
    userId: string,
    taskId: string,
    sortOrder: string,
    tx: DbClient,
  ): Promise<Task | null> {
    const result = await tx.task.updateMany({
      where: { id: taskId, userId },
      data: { sortOrder },
    });
    if (result.count === 0) return null;
    return this.findById(userId, taskId, tx);
  }

  async nextManual(
    userId: string,
    anchor: ManualAnchor,
    excludeId: string,
    tx: DbClient,
  ): Promise<ManualAnchor | null> {
    return tx.task.findFirst({
      where: manualNextWhere(userId, anchor, excludeId),
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, sortOrder: true },
    });
  }

  async previousManual(
    userId: string,
    anchor: ManualAnchor,
    excludeId: string,
    tx: DbClient,
  ): Promise<ManualAnchor | null> {
    return tx.task.findFirst({
      where: manualPreviousWhere(userId, anchor, excludeId),
      orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
      select: { id: true, sortOrder: true },
    });
  }

  async hasTaskBetween(
    userId: string,
    before: ManualAnchor,
    after: ManualAnchor,
    excludeId: string,
    tx: DbClient,
  ): Promise<boolean> {
    const row = await tx.task.findFirst({
      where: manualBetweenWhere(userId, before, after, excludeId),
      select: { id: true },
    });
    return row !== null;
  }
}
