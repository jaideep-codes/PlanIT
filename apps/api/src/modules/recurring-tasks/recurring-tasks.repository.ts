import { Injectable } from '@nestjs/common';
import type { OccurrenceStatus, TaskPriority } from '@planit/types';

import type { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { calendarDateToUtc, formatCalendarDate } from '../tasks/task-dates.js';
import type { RecurringCursor } from './recurring-cursor.js';

const SERIES_SELECT = {
  id: true,
  userId: true,
  title: true,
  notes: true,
  priority: true,
  recurrenceRule: true,
  startDate: true,
  endDate: true,
  timezone: true,
  enabled: true,
  estimatedMinutes: true,
  defaultStartMinute: true,
  createdAt: true,
  updatedAt: true,
} as const;

const OCCURRENCE_SELECT = {
  id: true,
  recurringTaskId: true,
  taskId: true,
  occurrenceDate: true,
  status: true,
  createdAt: true,
} as const;

type SeriesDb = Prisma.RecurringTaskGetPayload<{ select: typeof SERIES_SELECT }>;
type OccurrenceDb = Prisma.TaskOccurrenceGetPayload<{ select: typeof OCCURRENCE_SELECT }>;

export interface SeriesRow {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  priority: TaskPriority;
  recurrenceRule: string;
  startDate: string;
  endDate: string | null;
  timezone: string;
  enabled: boolean;
  estimatedMinutes: number | null;
  defaultStartMinute: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeriesWrite {
  title: string;
  notes: string | null;
  priority: TaskPriority;
  recurrenceRule: string;
  startDate: string;
  endDate: string | null;
  timezone: string;
  estimatedMinutes: number | null;
  defaultStartMinute: number | null;
}

export interface SeriesPatch {
  title?: string;
  notes?: string | null;
  priority?: TaskPriority;
  recurrenceRule?: string;
  startDate?: string;
  endDate?: string | null;
  timezone?: string;
  enabled?: boolean;
  estimatedMinutes?: number | null;
  defaultStartMinute?: number | null;
}

export interface OccurrenceRow {
  id: string;
  recurringTaskId: string;
  taskId: string | null;
  occurrenceDate: string;
  status: OccurrenceStatus;
  createdAt: string;
}

export interface OccurrenceWrite {
  userId: string;
  recurringTaskId: string;
  taskId: string | null;
  occurrenceDate: string;
  status: 'MATERIALIZED' | 'SKIPPED';
}

function toSeries(row: SeriesDb): SeriesRow {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    recurrenceRule: row.recurrenceRule,
    startDate: formatCalendarDate(row.startDate),
    endDate: row.endDate ? formatCalendarDate(row.endDate) : null,
    timezone: row.timezone,
    enabled: row.enabled,
    estimatedMinutes: row.estimatedMinutes,
    defaultStartMinute: row.defaultStartMinute,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toOccurrence(row: OccurrenceDb): OccurrenceRow {
  return {
    id: row.id,
    recurringTaskId: row.recurringTaskId,
    taskId: row.taskId,
    occurrenceDate: formatCalendarDate(row.occurrenceDate),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function dateOrNull(value: string | null): Date | null {
  return value === null ? null : calendarDateToUtc(value);
}

@Injectable()
export class RecurringTasksRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  async ownerTimezone(userId: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return row?.timezone ?? null;
  }

  /** Missing preference rows use the column default, Monday. */
  async weekStartsOn(userId: string, tx?: DbClient): Promise<number> {
    const row = await (tx ?? this.prisma).userPreference.findUnique({
      where: { userId },
      select: { weekStartsOn: true },
    });
    return row?.weekStartsOn ?? 1;
  }

  /** Enabled series for the daily job. The caller passes each row's userId back into the service. */
  async listEnabled(): Promise<Array<{ id: string; userId: string }>> {
    return this.prisma.recurringTask.findMany({
      where: { enabled: true },
      select: { id: true, userId: true },
    });
  }

  async findById(userId: string, seriesId: string, tx?: DbClient): Promise<SeriesRow | null> {
    const row = await (tx ?? this.prisma).recurringTask.findFirst({
      where: { id: seriesId, userId },
      select: SERIES_SELECT,
    });
    return row ? toSeries(row) : null;
  }

  async lockById(userId: string, seriesId: string, tx: DbClient): Promise<SeriesRow | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM recurring_tasks
      WHERE id = ${seriesId}::uuid AND user_id = ${userId}::uuid
      FOR UPDATE
    `;
    if (rows.length === 0) return null;
    return this.findById(userId, seriesId, tx);
  }

  async insert(userId: string, write: SeriesWrite, tx: DbClient): Promise<SeriesRow> {
    const row = await tx.recurringTask.create({
      data: {
        userId,
        title: write.title,
        notes: write.notes,
        priority: write.priority,
        recurrenceRule: write.recurrenceRule,
        startDate: calendarDateToUtc(write.startDate),
        endDate: dateOrNull(write.endDate),
        timezone: write.timezone,
        enabled: true,
        estimatedMinutes: write.estimatedMinutes,
        defaultStartMinute: write.defaultStartMinute,
      },
      select: SERIES_SELECT,
    });
    return toSeries(row);
  }

  async update(
    userId: string,
    seriesId: string,
    patch: SeriesPatch,
    tx: DbClient,
  ): Promise<SeriesRow | null> {
    const result = await tx.recurringTask.updateMany({
      where: { id: seriesId, userId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.recurrenceRule !== undefined ? { recurrenceRule: patch.recurrenceRule } : {}),
        ...(patch.startDate !== undefined ? { startDate: calendarDateToUtc(patch.startDate) } : {}),
        ...(patch.endDate !== undefined ? { endDate: dateOrNull(patch.endDate) } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.estimatedMinutes !== undefined
          ? { estimatedMinutes: patch.estimatedMinutes }
          : {}),
        ...(patch.defaultStartMinute !== undefined
          ? { defaultStartMinute: patch.defaultStartMinute }
          : {}),
      },
    });
    if (result.count === 0) return null;
    return this.findById(userId, seriesId, tx);
  }

  async delete(userId: string, seriesId: string, tx: DbClient): Promise<boolean> {
    const result = await tx.recurringTask.deleteMany({ where: { id: seriesId, userId } });
    return result.count > 0;
  }

  async page(userId: string, take: number, cursor: RecurringCursor | null): Promise<SeriesRow[]> {
    const rows = await this.prisma.recurringTask.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: SERIES_SELECT,
    });
    return rows.map(toSeries);
  }

  async occurrencesInRange(
    userId: string,
    seriesId: string,
    from: string,
    to: string,
    tx?: DbClient,
  ): Promise<OccurrenceRow[]> {
    const rows = await (tx ?? this.prisma).taskOccurrence.findMany({
      where: {
        userId,
        recurringTaskId: seriesId,
        occurrenceDate: { gte: calendarDateToUtc(from), lte: calendarDateToUtc(to) },
      },
      orderBy: [{ occurrenceDate: 'asc' }, { id: 'asc' }],
      select: OCCURRENCE_SELECT,
    });
    return rows.map(toOccurrence);
  }

  async findOccurrence(
    userId: string,
    seriesId: string,
    occurrenceDate: string,
    tx?: DbClient,
  ): Promise<OccurrenceRow | null> {
    const row = await (tx ?? this.prisma).taskOccurrence.findFirst({
      where: {
        userId,
        recurringTaskId: seriesId,
        occurrenceDate: calendarDateToUtc(occurrenceDate),
      },
      select: OCCURRENCE_SELECT,
    });
    return row ? toOccurrence(row) : null;
  }

  async insertOccurrence(write: OccurrenceWrite, tx: DbClient): Promise<OccurrenceRow> {
    const row = await tx.taskOccurrence.create({
      data: {
        userId: write.userId,
        recurringTaskId: write.recurringTaskId,
        taskId: write.taskId,
        occurrenceDate: calendarDateToUtc(write.occurrenceDate),
        status: write.status,
      },
      select: OCCURRENCE_SELECT,
    });
    return toOccurrence(row);
  }

  async markOccurrenceSkipped(
    userId: string,
    occurrenceId: string,
    tx: DbClient,
  ): Promise<OccurrenceRow | null> {
    const result = await tx.taskOccurrence.updateMany({
      where: { id: occurrenceId, userId },
      data: { status: 'SKIPPED', taskId: null },
    });
    if (result.count === 0) return null;
    const row = await tx.taskOccurrence.findFirst({
      where: { id: occurrenceId, userId },
      select: OCCURRENCE_SELECT,
    });
    return row ? toOccurrence(row) : null;
  }
}
