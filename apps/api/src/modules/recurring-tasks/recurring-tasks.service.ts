import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@planit/shared';
import type {
  CreateRecurringTaskRequest,
  ListRecurringTasksQuery,
  UpdateRecurringTaskRequest,
  UpdateTaskRequest,
} from '@planit/shared';
import type {
  RecurringTask,
  RecurringTaskList,
  Task,
  TaskOccurrence,
  TaskOccurrenceList,
} from '@planit/types';

import { AppException } from '../../common/errors/app.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../auth/request-meta.js';
import { between, FractionalIndexExhaustedError } from '../tasks/fractional-index.js';
import { TasksService } from '../tasks/tasks.service.js';
import { SystemClock } from './clock.js';
import { expandOccurrenceDates } from './recurrence-expand.js';
import {
  buildRecurrenceRule,
  parseRecurrenceRule,
  ruleInputFromStructured,
  wkstFromWeekStartsOn,
} from './recurrence-rule.js';
import {
  addCalendarDays,
  calendarDateInTimeZone,
  scheduleForOccurrence,
} from './recurrence-time.js';
import {
  BadRecurringCursorError,
  decodeRecurringCursor,
  encodeRecurringCursor,
} from './recurring-cursor.js';
import {
  RecurringTasksRepository,
  type OccurrenceRow,
  type SeriesRow,
} from './recurring-tasks.repository.js';

const AUDIT = {
  STOPPED: 'recurring_task.stopped',
  DELETED: 'recurring_task.deleted',
  SKIPPED: 'recurring_task.occurrence_skipped',
  DETACHED: 'recurring_task.occurrence_detached',
} as const;

const WINDOW_DAYS = 13;

function notFound(): AppException {
  return new AppException(ERROR_CODES.NOT_FOUND, 'Recurring task not found.', HttpStatus.NOT_FOUND);
}

function badRequest(message: string): AppException {
  return new AppException(ERROR_CODES.BAD_REQUEST, message, HttpStatus.BAD_REQUEST);
}

function conflict(message: string): AppException {
  return new AppException(ERROR_CODES.CONFLICT, message, HttpStatus.CONFLICT);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function toSeriesResponse(row: SeriesRow): RecurringTask {
  const rule = parseRecurrenceRule(row.recurrenceRule);
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    frequency: rule.frequency,
    interval: rule.interval,
    byDay: rule.byDay,
    byMonthDay: rule.byMonthDay,
    recurrenceRule: row.recurrenceRule,
    startDate: row.startDate,
    endDate: row.endDate,
    timezone: row.timezone,
    enabled: row.enabled,
    estimatedMinutes: row.estimatedMinutes,
    defaultStartMinute: row.defaultStartMinute,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOccurrenceResponse(row: OccurrenceRow): TaskOccurrence {
  return {
    id: row.id,
    recurringTaskId: row.recurringTaskId,
    taskId: row.taskId,
    occurrenceDate: row.occurrenceDate,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function frontKey(upper: string | null): string {
  try {
    return between(null, upper);
  } catch (error) {
    if (error instanceof FractionalIndexExhaustedError) {
      throw conflict('There is no room left between these tasks.');
    }
    throw error;
  }
}

@Injectable()
export class RecurringTasksService {
  constructor(
    private readonly series: RecurringTasksRepository,
    private readonly tasks: TasksService,
    private readonly audit: AuditService,
    private readonly clock: SystemClock,
  ) {}

  async create(userId: string, input: CreateRecurringTaskRequest): Promise<RecurringTask> {
    const timezone = input.timezone ?? (await this.series.ownerTimezone(userId));
    if (timezone === null) throw notFound();
    const rule = buildRecurrenceRule({
      frequency: input.frequency,
      interval: input.interval,
      byDay: input.byDay,
      byMonthDay: input.byMonthDay,
      startDate: input.startDate,
      wkst: wkstFromWeekStartsOn(await this.series.weekStartsOn(userId)),
    });
    const today = calendarDateInTimeZone(this.clock.now(), timezone);
    const row = await this.series.transaction(async (tx) => {
      const created = await this.series.insert(
        userId,
        {
          title: input.title,
          notes: input.notes ?? null,
          priority: input.priority ?? 'MEDIUM',
          recurrenceRule: rule.recurrenceRule,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          timezone,
          estimatedMinutes: input.estimatedMinutes ?? null,
          defaultStartMinute: input.defaultStartMinute ?? null,
        },
        tx,
      );
      await this.tasks.lockOwner(userId, tx);
      await this.insertMissing(userId, created, today, addCalendarDays(today, WINDOW_DAYS), tx);
      return created;
    });
    return toSeriesResponse(row);
  }

  async list(userId: string, query: ListRecurringTasksQuery): Promise<RecurringTaskList> {
    const cursor = query.cursor === undefined ? null : this.cursor(query.cursor);
    const rows = await this.series.page(userId, query.limit + 1, cursor);
    const items = rows.slice(0, query.limit).map(toSeriesResponse);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        rows.length > query.limit && last !== undefined ? encodeRecurringCursor(last) : null,
    };
  }

  async get(userId: string, seriesId: string): Promise<RecurringTask> {
    return toSeriesResponse(await this.require(userId, seriesId));
  }

  async update(
    userId: string,
    seriesId: string,
    input: UpdateRecurringTaskRequest,
  ): Promise<RecurringTask> {
    return this.series.transaction(async (tx) => {
      await this.tasks.lockOwner(userId, tx);
      const existing = await this.series.lockById(userId, seriesId, tx);
      if (!existing) throw notFound();
      const startDate = input.startDate ?? existing.startDate;
      const endDate = input.endDate !== undefined ? input.endDate : existing.endDate;
      if (endDate !== null && endDate < startDate) {
        throw badRequest('endDate must be on or after startDate.');
      }
      const estimatedMinutes =
        input.estimatedMinutes !== undefined ? input.estimatedMinutes : existing.estimatedMinutes;
      const defaultStartMinute =
        input.defaultStartMinute !== undefined
          ? input.defaultStartMinute
          : existing.defaultStartMinute;
      if (defaultStartMinute !== null && estimatedMinutes === null) {
        throw badRequest('Set an estimate before a start minute.');
      }
      const current = parseRecurrenceRule(existing.recurrenceRule);
      const wkst = wkstFromWeekStartsOn(await this.series.weekStartsOn(userId, tx));
      const next = buildRecurrenceRule(
        input.frequency === undefined
          ? ruleInputFromStructured(current, startDate, wkst)
          : {
              frequency: input.frequency,
              interval: input.interval ?? current.interval,
              byDay: input.byDay,
              byMonthDay: input.byMonthDay,
              startDate,
              wkst,
            },
      );
      const updated = await this.series.update(
        userId,
        seriesId,
        {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.startDate !== undefined ? { startDate } : {}),
          ...(input.endDate !== undefined ? { endDate } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(input.estimatedMinutes !== undefined ? { estimatedMinutes } : {}),
          ...(input.defaultStartMinute !== undefined ? { defaultStartMinute } : {}),
          recurrenceRule: next.recurrenceRule,
        },
        tx,
      );
      if (!updated) throw notFound();
      return toSeriesResponse(updated);
    });
  }

  async delete(userId: string, seriesId: string, meta: RequestMeta): Promise<RecurringTask> {
    return this.series.transaction(async (tx) => {
      await this.tasks.lockOwner(userId, tx);
      const existing = await this.series.lockById(userId, seriesId, tx);
      if (!existing) throw notFound();
      const response = toSeriesResponse(existing);
      await this.tasks.deleteOpenForSeries(userId, seriesId, tx);
      await this.tasks.detachCompletedForSeries(userId, seriesId, tx);
      const removed = await this.series.delete(userId, seriesId, tx);
      if (!removed) throw notFound();
      await this.record(userId, AUDIT.DELETED, seriesId, {}, meta, tx);
      return response;
    });
  }

  async stop(userId: string, seriesId: string, meta: RequestMeta): Promise<RecurringTask> {
    return this.series.transaction(async (tx) => {
      await this.tasks.lockOwner(userId, tx);
      const existing = await this.series.lockById(userId, seriesId, tx);
      if (!existing) throw notFound();
      const today = calendarDateInTimeZone(this.clock.now(), existing.timezone);
      const yesterday = addCalendarDays(today, -1);
      const endDate = yesterday < existing.startDate ? existing.startDate : yesterday;
      const updated = await this.series.update(userId, seriesId, { enabled: false, endDate }, tx);
      if (!updated) throw notFound();
      await this.record(userId, AUDIT.STOPPED, seriesId, { enabled: false }, meta, tx);
      return toSeriesResponse(updated);
    });
  }

  async skip(
    userId: string,
    seriesId: string,
    occurrenceDate: string,
    meta: RequestMeta,
  ): Promise<TaskOccurrence> {
    return this.series.transaction(async (tx) => {
      await this.tasks.lockOwner(userId, tx);
      const existing = await this.series.lockById(userId, seriesId, tx);
      if (!existing) throw notFound();
      this.requireDate(existing, occurrenceDate);
      const occurrence = await this.series.findOccurrence(userId, seriesId, occurrenceDate, tx);
      if (occurrence?.status === 'SKIPPED') return toOccurrenceResponse(occurrence);
      if (occurrence?.status === 'COMPLETED') {
        throw conflict('This occurrence cannot be skipped.');
      }
      if (occurrence?.taskId) {
        const task = await this.tasks.lockTask(userId, occurrence.taskId, tx);
        if (!task || task.status === 'COMPLETED' || task.recurringTaskId === null) {
          throw conflict('This occurrence cannot be skipped.');
        }
        const skipped = await this.series.markOccurrenceSkipped(userId, occurrence.id, tx);
        if (!skipped) throw conflict('This occurrence cannot be skipped.');
        await this.tasks.deleteWithin(userId, task.id, tx);
        await this.record(
          userId,
          AUDIT.SKIPPED,
          seriesId,
          { occurrenceId: skipped.id, status: 'SKIPPED' },
          meta,
          tx,
        );
        return toOccurrenceResponse(skipped);
      }
      if (occurrence) throw conflict('This occurrence cannot be skipped.');
      const created = await this.series.insertOccurrence(
        {
          userId,
          recurringTaskId: seriesId,
          taskId: null,
          occurrenceDate,
          status: 'SKIPPED',
        },
        tx,
      );
      await this.record(
        userId,
        AUDIT.SKIPPED,
        seriesId,
        { occurrenceId: created.id, status: 'SKIPPED' },
        meta,
        tx,
      );
      return toOccurrenceResponse(created);
    });
  }

  async editOccurrence(
    userId: string,
    seriesId: string,
    occurrenceDate: string,
    input: UpdateTaskRequest,
    meta: RequestMeta,
  ): Promise<Task> {
    return this.series.transaction(async (tx) => {
      await this.tasks.lockOwner(userId, tx);
      const existing = await this.series.lockById(userId, seriesId, tx);
      if (!existing) throw notFound();
      this.requireDate(existing, occurrenceDate);
      let occurrence = await this.series.findOccurrence(userId, seriesId, occurrenceDate, tx);
      if (!occurrence) {
        await this.insertMissing(userId, existing, occurrenceDate, occurrenceDate, tx);
        occurrence = await this.series.findOccurrence(userId, seriesId, occurrenceDate, tx);
      }
      if (!occurrence?.taskId) throw conflict('This occurrence cannot be edited.');
      const task = await this.tasks.lockTask(userId, occurrence.taskId, tx);
      if (!task) throw conflict('This occurrence cannot be edited.');
      const updated = await this.tasks.updateWithin(userId, task.id, input, tx);
      if (!updated) throw notFound();
      if (task.recurringTaskId === null) return updated;
      const detached = await this.tasks.clearRecurringLink(userId, task.id, tx);
      if (!detached) throw notFound();
      await this.record(
        userId,
        AUDIT.DETACHED,
        seriesId,
        { occurrenceId: occurrence.id, taskId: task.id, status: occurrence.status },
        meta,
        tx,
      );
      return detached;
    });
  }

  async occurrences(
    userId: string,
    seriesId: string,
    from: string,
    to: string,
  ): Promise<TaskOccurrenceList> {
    const items = await this.syncWindow(userId, seriesId, from, to);
    return { items: items.map(toOccurrenceResponse), nextCursor: null };
  }

  /**
   * Daily job entry. Each series is materialized for its owner, today through today
   * plus 13 days in that series timezone. A failure is an id only.
   */
  async materializeEnabled(): Promise<string[]> {
    const rows = await this.series.listEnabled();
    const failed: string[] = [];
    for (const row of rows) {
      try {
        const existing = await this.series.findById(row.userId, row.id);
        if (!existing?.enabled) continue;
        const today = calendarDateInTimeZone(this.clock.now(), existing.timezone);
        await this.syncWindow(row.userId, row.id, today, addCalendarDays(today, WINDOW_DAYS));
      } catch (error) {
        if (error instanceof AppException && error.code === ERROR_CODES.NOT_FOUND) continue;
        failed.push(row.id);
      }
    }
    return failed;
  }

  private async syncWindow(
    userId: string,
    seriesId: string,
    from: string,
    to: string,
  ): Promise<OccurrenceRow[]> {
    try {
      return await this.materializeWindow(userId, seriesId, from, to);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.series.occurrencesInRange(userId, seriesId, from, to);
    }
  }

  private async materializeWindow(
    userId: string,
    seriesId: string,
    from: string,
    to: string,
  ): Promise<OccurrenceRow[]> {
    return this.series.transaction(async (tx) => {
      await this.tasks.lockOwner(userId, tx);
      const existing = await this.series.lockById(userId, seriesId, tx);
      if (!existing) throw notFound();
      if (existing.enabled) await this.insertMissing(userId, existing, from, to, tx);
      return this.series.occurrencesInRange(userId, seriesId, from, to, tx);
    });
  }

  /** Caller holds the owner lock. Dates already represented by any occurrence row are left alone. */
  private async insertMissing(
    userId: string,
    series: SeriesRow,
    from: string,
    to: string,
    tx: DbClient,
  ): Promise<void> {
    const dates = expandOccurrenceDates({
      recurrenceRule: series.recurrenceRule,
      startDate: series.startDate,
      endDate: series.endDate,
      from,
      to,
    });
    const present = new Set(
      (await this.series.occurrencesInRange(userId, series.id, from, to, tx)).map(
        (row) => row.occurrenceDate,
      ),
    );
    const missing = dates
      .filter((date) => !present.has(date))
      .sort()
      .reverse();
    if (missing.length === 0) return;
    let upper = await this.tasks.lowestSortOrder(userId, tx);
    for (const occurrenceDate of missing) {
      const sortOrder = frontKey(upper);
      const schedule = scheduleForOccurrence({
        occurrenceDate,
        timeZone: series.timezone,
        defaultStartMinute: series.defaultStartMinute,
        estimatedMinutes: series.estimatedMinutes,
      });
      const task = await this.tasks.createGenerated(
        userId,
        {
          title: series.title,
          notes: series.notes,
          priority: series.priority,
          dueDate: occurrenceDate,
          scheduledStart: schedule.scheduledStart,
          scheduledEnd: schedule.scheduledEnd,
          estimatedMinutes: series.estimatedMinutes,
          sortOrder,
          recurringTaskId: series.id,
        },
        tx,
      );
      await this.series.insertOccurrence(
        {
          userId,
          recurringTaskId: series.id,
          taskId: task.id,
          occurrenceDate,
          status: 'MATERIALIZED',
        },
        tx,
      );
      upper = sortOrder;
    }
  }

  private requireDate(series: SeriesRow, occurrenceDate: string): void {
    const matches = expandOccurrenceDates({
      recurrenceRule: series.recurrenceRule,
      startDate: series.startDate,
      endDate: series.endDate,
      from: occurrenceDate,
      to: occurrenceDate,
    });
    if (!matches.includes(occurrenceDate)) {
      throw badRequest('That date is not part of this series.');
    }
  }

  private async require(userId: string, seriesId: string): Promise<SeriesRow> {
    const row = await this.series.findById(userId, seriesId);
    if (!row) throw notFound();
    return row;
  }

  private cursor(cursor: string): ReturnType<typeof decodeRecurringCursor> {
    try {
      return decodeRecurringCursor(cursor);
    } catch (error) {
      if (error instanceof BadRecurringCursorError) throw badRequest('The cursor is invalid.');
      throw error;
    }
  }

  private record(
    userId: string,
    action: (typeof AUDIT)[keyof typeof AUDIT],
    seriesId: string,
    metadata: { enabled?: false; occurrenceId?: string; taskId?: string; status?: string },
    meta: RequestMeta,
    tx: DbClient,
  ): Promise<void> {
    return this.audit.record(
      {
        userId,
        action,
        targetType: 'recurring_task',
        targetId: seriesId,
        metadata,
        requestId: meta.requestId,
        ip: meta.ip,
      },
      tx,
    );
  }
}
