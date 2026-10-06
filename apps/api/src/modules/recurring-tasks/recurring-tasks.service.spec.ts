import { HttpStatus } from '@nestjs/common';
import type { Task, TaskPriority } from '@planit/types';
import { describe, expect, it } from 'vitest';

import { AppException } from '../../common/errors/app.exception.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import type { AuditService, AuditWrite } from '../audit/audit.service.js';
import type { RequestMeta } from '../auth/request-meta.js';
import type { TasksService } from '../tasks/tasks.service.js';
import { SystemClock } from './clock.js';
import type {
  RecurringTasksRepository,
  SeriesRow,
  SeriesWrite,
} from './recurring-tasks.repository.js';
import { RecurringTasksService } from './recurring-tasks.service.js';

const META: RequestMeta = { ip: '127.0.0.1', userAgent: null, requestId: 'req-series-1' };
const TX = {} as DbClient;

class FixedClock extends SystemClock {
  constructor(private readonly instant: string) {
    super();
  }

  override now(): Date {
    return new Date(this.instant);
  }
}

function nid(n: number): string {
  return `01990000-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

class Memory {
  series = new Map<string, SeriesRow>();
  tasks = new Map<string, Task>();
  occurrences = new Map<
    string,
    {
      id: string;
      userId: string;
      recurringTaskId: string;
      taskId: string | null;
      occurrenceDate: string;
      status: 'MATERIALIZED' | 'SKIPPED' | 'COMPLETED';
      createdAt: string;
    }
  >();
  weekStartsOn = 1;
  timezone: string | null = 'UTC';
  private seq = 0;
  private stampMs = Date.parse('2026-03-01T00:00:00.000Z');

  nextId(): string {
    this.seq += 1;
    return nid(this.seq);
  }

  stamp(): string {
    this.stampMs += 1000;
    return new Date(this.stampMs).toISOString();
  }

  taskOn(date: string): Task | undefined {
    return [...this.tasks.values()].find((task) => task.dueDate === date);
  }
}

class FakeSeries {
  constructor(private readonly db: Memory) {}

  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return fn(TX);
  }

  ownerTimezone(): Promise<string | null> {
    return Promise.resolve(this.db.timezone);
  }

  weekStartsOn(): Promise<number> {
    return Promise.resolve(this.db.weekStartsOn);
  }

  listEnabled(): Promise<Array<{ id: string; userId: string }>> {
    return Promise.resolve(
      [...this.db.series.values()]
        .filter((row) => row.enabled)
        .map((row) => ({ id: row.id, userId: row.userId })),
    );
  }

  findById(userId: string, seriesId: string): Promise<SeriesRow | null> {
    const row = this.db.series.get(seriesId);
    return Promise.resolve(row && row.userId === userId ? row : null);
  }

  lockById(userId: string, seriesId: string): Promise<SeriesRow | null> {
    return this.findById(userId, seriesId);
  }

  insert(userId: string, write: SeriesWrite): Promise<SeriesRow> {
    const now = this.db.stamp();
    const row: SeriesRow = {
      id: this.db.nextId(),
      userId,
      title: write.title,
      notes: write.notes,
      priority: write.priority,
      recurrenceRule: write.recurrenceRule,
      startDate: write.startDate,
      endDate: write.endDate,
      timezone: write.timezone,
      enabled: true,
      estimatedMinutes: write.estimatedMinutes,
      defaultStartMinute: write.defaultStartMinute,
      createdAt: now,
      updatedAt: now,
    };
    this.db.series.set(row.id, row);
    return Promise.resolve(row);
  }

  update(userId: string, seriesId: string, patch: Partial<SeriesRow>): Promise<SeriesRow | null> {
    const current = this.db.series.get(seriesId);
    if (!current || current.userId !== userId) return Promise.resolve(null);
    const next = { ...current, ...patch, updatedAt: this.db.stamp() };
    this.db.series.set(seriesId, next);
    return Promise.resolve(next);
  }

  delete(userId: string, seriesId: string): Promise<boolean> {
    const current = this.db.series.get(seriesId);
    if (!current || current.userId !== userId) return Promise.resolve(false);
    this.db.series.delete(seriesId);
    for (const [key, row] of this.db.occurrences) {
      if (row.recurringTaskId === seriesId) this.db.occurrences.delete(key);
    }
    return Promise.resolve(true);
  }

  page(userId: string, take: number, cursor: { createdAt: Date; id: string } | null) {
    const cursorTime = cursor?.createdAt.toISOString();
    const rows = [...this.db.series.values()]
      .filter((row) => row.userId === userId)
      .filter((row) => {
        if (!cursor || !cursorTime) return true;
        return row.createdAt < cursorTime || (row.createdAt === cursorTime && row.id < cursor.id);
      })
      .sort((left, right) => {
        if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
        return left.id < right.id ? 1 : -1;
      });
    return Promise.resolve(rows.slice(0, take));
  }

  occurrencesInRange(userId: string, seriesId: string, from: string, to: string) {
    const rows = [...this.db.occurrences.values()]
      .filter(
        (row) =>
          row.userId === userId &&
          row.recurringTaskId === seriesId &&
          row.occurrenceDate >= from &&
          row.occurrenceDate <= to,
      )
      .sort((left, right) => left.occurrenceDate.localeCompare(right.occurrenceDate));
    return Promise.resolve(rows);
  }

  findOccurrence(userId: string, seriesId: string, occurrenceDate: string) {
    const row = [...this.db.occurrences.values()].find(
      (item) =>
        item.userId === userId &&
        item.recurringTaskId === seriesId &&
        item.occurrenceDate === occurrenceDate,
    );
    return Promise.resolve(row ?? null);
  }

  insertOccurrence(write: {
    userId: string;
    recurringTaskId: string;
    taskId: string | null;
    occurrenceDate: string;
    status: 'MATERIALIZED' | 'SKIPPED';
  }) {
    const key = `${write.recurringTaskId}:${write.occurrenceDate}`;
    if (this.db.occurrences.has(key)) throw new Error('duplicate occurrence');
    const row = {
      id: this.db.nextId(),
      userId: write.userId,
      recurringTaskId: write.recurringTaskId,
      taskId: write.taskId,
      occurrenceDate: write.occurrenceDate,
      status: write.status,
      createdAt: this.db.stamp(),
    };
    this.db.occurrences.set(key, row);
    return Promise.resolve(row);
  }

  markOccurrenceSkipped(userId: string, occurrenceId: string) {
    const row = [...this.db.occurrences.values()].find(
      (item) => item.id === occurrenceId && item.userId === userId,
    );
    if (!row) return Promise.resolve(null);
    row.status = 'SKIPPED';
    row.taskId = null;
    return Promise.resolve(row);
  }
}

class FakeTasks {
  constructor(private readonly db: Memory) {}

  lockOwner(): Promise<void> {
    return Promise.resolve();
  }

  lowestSortOrder(): Promise<string | null> {
    const orders = [...this.db.tasks.values()].map((task) => task.sortOrder);
    if (orders.length === 0) return Promise.resolve(null);
    return Promise.resolve([...orders].sort()[0] ?? null);
  }

  createGenerated(
    userId: string,
    write: {
      title: string;
      notes: string | null;
      priority: TaskPriority;
      dueDate: string;
      scheduledStart: Date | null;
      scheduledEnd: Date | null;
      estimatedMinutes: number | null;
      sortOrder: string;
      recurringTaskId: string;
    },
  ): Promise<Task> {
    const now = this.db.stamp();
    const task: Task = {
      id: this.db.nextId(),
      title: write.title,
      notes: write.notes,
      priority: write.priority,
      status: 'TODO',
      dueDate: write.dueDate,
      scheduledStart: write.scheduledStart ? write.scheduledStart.toISOString() : null,
      scheduledEnd: write.scheduledEnd ? write.scheduledEnd.toISOString() : null,
      estimatedMinutes: write.estimatedMinutes,
      completedAt: null,
      sortOrder: write.sortOrder,
      recurringTaskId: write.recurringTaskId,
      createdAt: now,
      updatedAt: now,
    };
    void userId;
    this.db.tasks.set(task.id, task);
    return Promise.resolve(task);
  }

  lockTask(userId: string, taskId: string): Promise<Task | null> {
    void userId;
    return Promise.resolve(this.db.tasks.get(taskId) ?? null);
  }

  updateWithin(
    userId: string,
    taskId: string,
    input: { title?: string; notes?: string | null; priority?: TaskPriority },
  ): Promise<Task | null> {
    void userId;
    const current = this.db.tasks.get(taskId);
    if (!current) return Promise.resolve(null);
    const next: Task = {
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    };
    this.db.tasks.set(taskId, next);
    return Promise.resolve(next);
  }

  deleteWithin(userId: string, taskId: string): Promise<boolean> {
    void userId;
    return Promise.resolve(this.db.tasks.delete(taskId));
  }

  clearRecurringLink(userId: string, taskId: string): Promise<Task | null> {
    void userId;
    const current = this.db.tasks.get(taskId);
    if (!current) return Promise.resolve(null);
    const next = { ...current, recurringTaskId: null };
    this.db.tasks.set(taskId, next);
    return Promise.resolve(next);
  }

  deleteOpenForSeries(userId: string, seriesId: string): Promise<void> {
    void userId;
    for (const [id, task] of this.db.tasks) {
      if (task.recurringTaskId === seriesId && task.status !== 'COMPLETED')
        this.db.tasks.delete(id);
    }
    return Promise.resolve();
  }

  detachCompletedForSeries(userId: string, seriesId: string): Promise<void> {
    void userId;
    for (const [id, task] of this.db.tasks) {
      if (task.recurringTaskId === seriesId && task.status === 'COMPLETED') {
        this.db.tasks.set(id, { ...task, recurringTaskId: null });
      }
    }
    return Promise.resolve();
  }
}

function harness(instant: string) {
  const db = new Memory();
  const events: AuditWrite[] = [];
  const service = new RecurringTasksService(
    new FakeSeries(db) as unknown as RecurringTasksRepository,
    new FakeTasks(db) as unknown as TasksService,
    {
      record: (event: AuditWrite) => {
        events.push(event);
        return Promise.resolve();
      },
    } as unknown as AuditService,
    new FixedClock(instant),
  );
  return { db, events, service };
}

const DAILY = {
  title: 'Standup',
  frequency: 'DAILY' as const,
  interval: 1,
  startDate: '2026-03-10',
};

async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AppException);
  try {
    await promise;
  } catch (error) {
    expect((error as AppException).getStatus()).toBe(status);
  }
}

describe('RecurringTasksService', () => {
  it('does not insert a second task when the generator runs again', async () => {
    const { db, service } = harness('2026-03-10T12:00:00.000Z');
    const created = await service.create('owner', DAILY);
    expect(db.tasks.size).toBe(14);
    const earliest = db.taskOn('2026-03-10');
    const latest = db.taskOn('2026-03-23');
    expect(earliest && latest && earliest.sortOrder < latest.sortOrder).toBe(true);
    await service.occurrences('owner', created.id, '2026-03-10', '2026-03-23');
    expect(db.tasks.size).toBe(14);
    await expectStatus(service.get('other', created.id), HttpStatus.NOT_FOUND);
  });

  it('keeps a skipped date skipped on the next pass', async () => {
    const { db, events, service } = harness('2026-03-10T12:00:00.000Z');
    const created = await service.create('owner', DAILY);
    const skipped = await service.skip('owner', created.id, '2026-03-11', META);
    const again = await service.skip('owner', created.id, '2026-03-11', META);
    expect(again).toEqual(skipped);
    expect(db.taskOn('2026-03-11')).toBeUndefined();
    await service.occurrences('owner', created.id, '2026-03-10', '2026-03-23');
    expect(db.taskOn('2026-03-11')).toBeUndefined();
    expect(
      events.filter((event) => event.action === 'recurring_task.occurrence_skipped'),
    ).toHaveLength(1);
    await expectStatus(
      service.editOccurrence('owner', created.id, '2026-03-11', { title: 'Nope' }, META),
      HttpStatus.CONFLICT,
    );
  });

  it('leaves detached and already materialized tasks unchanged when the series title changes', async () => {
    const { db, service } = harness('2026-03-10T12:00:00.000Z');
    const created = await service.create('owner', DAILY);
    const detached = await service.editOccurrence(
      'owner',
      created.id,
      '2026-03-12',
      { title: 'Mine' },
      META,
    );
    expect(detached.recurringTaskId).toBeNull();
    await service.update('owner', created.id, { title: 'New' });
    expect(db.taskOn('2026-03-12')?.title).toBe('Mine');
    expect(db.taskOn('2026-03-10')?.title).toBe('Standup');
    await service.occurrences('owner', created.id, '2026-03-24', '2026-03-25');
    expect(db.taskOn('2026-03-24')?.title).toBe('New');
    expect(db.taskOn('2026-03-10')?.title).toBe('Standup');
    expect(db.taskOn('2026-03-12')?.recurringTaskId).toBeNull();
  });

  it('does not generate more tasks after stop', async () => {
    const { db, events, service } = harness('2026-03-10T12:00:00.000Z');
    const created = await service.create('owner', DAILY);
    const stopped = await service.stop('owner', created.id, META);
    expect(stopped.enabled).toBe(false);
    expect(stopped.endDate).toBe('2026-03-10');
    const count = db.tasks.size;
    await service.occurrences('owner', created.id, '2026-03-01', '2026-04-30');
    expect(db.tasks.size).toBe(count);
    expect(JSON.stringify(events)).not.toContain('Standup');
    expect(events.some((event) => event.action === 'recurring_task.stopped')).toBe(true);
  });

  it('creates one gap-day task with no schedule and does not duplicate the fall-back hour', async () => {
    const gap = harness('2026-03-08T15:00:00.000Z');
    const gapSeries = await gap.service.create('owner', {
      ...DAILY,
      title: 'Gap',
      startDate: '2026-03-08',
      timezone: 'America/New_York',
      estimatedMinutes: 30,
      defaultStartMinute: 150,
    });
    expect(gap.db.taskOn('2026-03-08')).toMatchObject({
      dueDate: '2026-03-08',
      scheduledStart: null,
      scheduledEnd: null,
    });
    const gapCount = gap.db.tasks.size;
    await gap.service.occurrences('owner', gapSeries.id, '2026-03-08', '2026-03-21');
    expect(gap.db.tasks.size).toBe(gapCount);

    const overlap = harness('2026-11-01T15:00:00.000Z');
    const overlapSeries = await overlap.service.create('owner', {
      ...DAILY,
      title: 'Overlap',
      startDate: '2026-11-01',
      timezone: 'America/New_York',
      estimatedMinutes: 30,
      defaultStartMinute: 90,
    });
    expect(overlap.db.taskOn('2026-11-01')?.scheduledStart).toBe('2026-11-01T05:30:00.000Z');
    expect(overlap.db.taskOn('2026-11-01')?.scheduledEnd).toBe('2026-11-01T06:00:00.000Z');
    const overlapCount = overlap.db.tasks.size;
    await overlap.service.occurrences('owner', overlapSeries.id, '2026-11-01', '2026-11-14');
    expect(overlap.db.tasks.size).toBe(overlapCount);
  });

  it('copies WKST at create and refreshes it when the series is edited', async () => {
    const { db, service } = harness('2026-03-10T12:00:00.000Z');
    db.weekStartsOn = 0;
    const created = await service.create('owner', DAILY);
    expect(created.recurrenceRule).toContain('WKST=SU');
    db.weekStartsOn = 1;
    const renamed = await service.update('owner', created.id, { title: 'Renamed' });
    expect(renamed.recurrenceRule).toContain('WKST=MO');
    expect(db.taskOn('2026-03-10')?.title).toBe('Standup');
  });
});
