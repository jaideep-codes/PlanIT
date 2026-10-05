import { HttpStatus } from '@nestjs/common';
import type { Task } from '@planit/types';
import { describe, expect, it } from 'vitest';

import { AppException } from '../../common/errors/app.exception.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import type { AuditService, AuditWrite } from '../audit/audit.service.js';
import type { RequestMeta } from '../auth/request-meta.js';
import { TasksService } from './tasks.service.js';
import type {
  ManualAnchor,
  TaskFieldPatch,
  TaskPageQuery,
  TaskWrite,
  TasksRepository,
} from './tasks.repository.js';

const META: RequestMeta = { ip: '127.0.0.1', userAgent: null, requestId: 'req-task-01' };

function sample(overrides: Partial<Task> = {}): Task {
  return {
    id: '01990000-0000-7000-8000-000000000001',
    title: 'Plan',
    notes: null,
    priority: 'MEDIUM',
    status: 'TODO',
    dueDate: null,
    scheduledStart: null,
    scheduledEnd: null,
    estimatedMinutes: null,
    completedAt: null,
    sortOrder: 'a0',
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  };
}

class FakeTasks {
  lowest: string | null = null;
  blocked = false;
  next: ManualAnchor | null = null;
  previous: ManualAnchor | null = null;
  rows: Task[] = [];
  writes: TaskWrite[] = [];
  pages: TaskPageQuery[] = [];
  completeCalls = 0;
  reopenCalls = 0;
  private readonly stored = new Map<string, Task>();

  constructor(tasks: Task[] = []) {
    for (const task of tasks) this.stored.set(task.id, task);
  }

  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return fn({} as DbClient);
  }

  defaultSort(): Promise<'MANUAL' | 'PRIORITY'> {
    return Promise.resolve(this.preference);
  }

  preference: 'MANUAL' | 'PRIORITY' = 'MANUAL';

  page(_userId: string, query: TaskPageQuery): Promise<Task[]> {
    this.pages.push(query);
    return Promise.resolve(this.rows);
  }

  findById(userId: string, taskId: string): Promise<Task | null> {
    return Promise.resolve(this.visible(userId, taskId));
  }

  lockUser(): Promise<void> {
    return Promise.resolve();
  }

  lockTask(userId: string, taskId: string): Promise<Task | null> {
    return this.findById(userId, taskId);
  }

  lowestSortOrder(): Promise<string | null> {
    return Promise.resolve(this.lowest);
  }

  create(_userId: string, write: TaskWrite): Promise<Task> {
    this.writes.push(write);
    return Promise.resolve(
      sample({ title: write.title, sortOrder: write.sortOrder, priority: write.priority }),
    );
  }

  update(userId: string, taskId: string, patch: TaskFieldPatch): Promise<Task | null> {
    const current = this.visible(userId, taskId);
    if (!current) return Promise.resolve(null);
    const next: Task = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      ...(patch.status !== undefined ? { status: patch.status, completedAt: null } : {}),
    };
    this.stored.set(taskId, next);
    return Promise.resolve(next);
  }

  delete(userId: string, taskId: string): Promise<boolean> {
    return Promise.resolve(this.stored.delete(`${userId}:${taskId}`) || this.stored.delete(taskId));
  }

  complete(userId: string, taskId: string, completedAt: Date): Promise<Task | null> {
    this.completeCalls += 1;
    const current = this.visible(userId, taskId);
    if (!current || current.status === 'COMPLETED') return Promise.resolve(null);
    const next = {
      ...current,
      status: 'COMPLETED' as const,
      completedAt: completedAt.toISOString(),
    };
    this.stored.set(taskId, next);
    return Promise.resolve(next);
  }

  reopen(userId: string, taskId: string): Promise<Task | null> {
    this.reopenCalls += 1;
    const current = this.visible(userId, taskId);
    if (!current || current.status !== 'COMPLETED') return Promise.resolve(null);
    const next = { ...current, status: 'TODO' as const, completedAt: null };
    this.stored.set(taskId, next);
    return Promise.resolve(next);
  }

  setSortOrder(userId: string, taskId: string, sortOrder: string): Promise<Task | null> {
    const current = this.visible(userId, taskId);
    if (!current) return Promise.resolve(null);
    const next = { ...current, sortOrder };
    this.stored.set(taskId, next);
    return Promise.resolve(next);
  }

  nextManual(): Promise<ManualAnchor | null> {
    return Promise.resolve(this.next);
  }

  previousManual(): Promise<ManualAnchor | null> {
    return Promise.resolve(this.previous);
  }

  hasTaskBetween(): Promise<boolean> {
    return Promise.resolve(this.blocked);
  }

  storedSet(task: Task): void {
    this.stored.set(task.id, task);
  }

  private visible(userId: string, taskId: string): Task | null {
    if (userId !== 'owner') return null;
    return this.stored.get(taskId) ?? null;
  }
}

function service(fake: FakeTasks, events: AuditWrite[] = []) {
  const audit = {
    record: (event: AuditWrite) => {
      events.push(event);
      return Promise.resolve();
    },
  };
  return new TasksService(fake as unknown as TasksRepository, audit as unknown as AuditService);
}

async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AppException);
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(status);
  }
}

describe('TasksService', () => {
  it('inserts a new task at the front of the manual order', async () => {
    const first = new FakeTasks();
    const created = await service(first).create('owner', { title: 'First' });
    expect(created.sortOrder).toBe('a0');
    expect(first.writes[0]).toMatchObject({
      title: 'First',
      notes: null,
      priority: 'MEDIUM',
      dueDate: null,
      scheduledStart: null,
      scheduledEnd: null,
      estimatedMinutes: null,
      sortOrder: 'a0',
    });

    const later = new FakeTasks();
    later.lowest = 'a0';
    const second = await service(later).create('owner', { title: 'Second', priority: 'HIGH' });
    expect(second.sortOrder < 'a0').toBe(true);
    expect(later.writes[0]?.priority).toBe('HIGH');
  });

  it('uses the saved sort when the query omits one, and rejects a bad cursor', async () => {
    const fake = new FakeTasks();
    fake.preference = 'PRIORITY';
    fake.rows = [sample({ priority: 'HIGH' })];
    const page = await service(fake).list('owner', { limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    expect(fake.pages[0]).toMatchObject({
      take: 21,
      sort: { field: 'priority', descending: false },
    });

    const listed = new FakeTasks([sample()]);
    listed.rows = [sample(), sample({ id: '01990000-0000-7000-8000-000000000002' })];
    const cursorPage = await service(listed).list('owner', {
      limit: 1,
      sort: 'manual',
    });
    expect(cursorPage.items).toHaveLength(1);
    expect(cursorPage.nextCursor).toEqual(expect.any(String));

    await expectStatus(
      service(listed).list('owner', { limit: 20, cursor: 'not-a-cursor' }),
      HttpStatus.BAD_REQUEST,
    );
  });

  it('audits a real completion once and refuses to reopen anything else', async () => {
    const events: AuditWrite[] = [];
    const todo = sample();
    const fake = new FakeTasks([todo]);
    const tasks = service(fake, events);
    const completed = await tasks.complete('owner', todo.id, META);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).toEqual(expect.any(String));
    expect(events).toEqual([
      expect.objectContaining({
        action: 'task.completed',
        targetType: 'task',
        targetId: todo.id,
        metadata: { previousStatus: 'TODO' },
      }),
    ]);

    fake.storedSet(completed);
    const again = await tasks.complete('owner', todo.id, META);
    expect(again.completedAt).toBe(completed.completedAt);
    expect(fake.completeCalls).toBe(1);
    expect(events).toHaveLength(1);

    const reopened = await tasks.reopen('owner', todo.id, META);
    expect(reopened.status).toBe('TODO');
    expect(reopened.completedAt).toBeNull();
    expect(events[1]).toMatchObject({ action: 'task.reopened', metadata: {} });

    await expectStatus(tasks.reopen('owner', todo.id, META), HttpStatus.CONFLICT);
    expect(fake.reopenCalls).toBe(1);
    expect(events).toHaveLength(2);
    await expectStatus(tasks.get('intruder', todo.id), HttpStatus.NOT_FOUND);
  });

  it('deletes with an audit row and repositions only between adjacent neighbors', async () => {
    const events: AuditWrite[] = [];
    const moving = sample({ id: '01990000-0000-7000-8000-00000000000a', sortOrder: 'a1' });
    const before = sample({ id: '01990000-0000-7000-8000-00000000000b', sortOrder: 'a0' });
    const after = sample({ id: '01990000-0000-7000-8000-00000000000c', sortOrder: 'a2' });
    const fake = new FakeTasks([moving, before, after]);
    const tasks = service(fake, events);

    const deleted = await tasks.delete('owner', moving.id, META);
    expect(deleted.id).toBe(moving.id);
    expect(events[0]).toMatchObject({
      action: 'task.deleted',
      metadata: {},
      targetType: 'task',
      targetId: moving.id,
    });
    expect(JSON.stringify(events)).not.toContain(moving.title);

    fake.storedSet(moving);
    const placed = await tasks.reposition('owner', moving.id, {
      beforeId: before.id,
      afterId: after.id,
    });
    expect(placed.sortOrder > before.sortOrder && placed.sortOrder < after.sortOrder).toBe(true);

    fake.blocked = true;
    await expectStatus(
      tasks.reposition('owner', moving.id, { beforeId: before.id, afterId: after.id }),
      HttpStatus.BAD_REQUEST,
    );

    await expectStatus(
      tasks.reposition('owner', moving.id, {
        beforeId: '01990000-0000-7000-8000-0000000000ff',
      }),
      HttpStatus.NOT_FOUND,
    );

    const tight = new FakeTasks([
      sample({ id: moving.id, sortOrder: 'a0' }),
      sample({ id: before.id, sortOrder: 'a0' }),
      sample({ id: after.id, sortOrder: 'a0' }),
    ]);
    await expectStatus(
      service(tight).reposition('owner', moving.id, { beforeId: before.id, afterId: after.id }),
      HttpStatus.CONFLICT,
    );
  });

  it('returns 404 when a field edit cannot see the task', async () => {
    const fake = new FakeTasks();
    await expectStatus(
      service(fake).update('owner', sample().id, { title: 'Next' }),
      HttpStatus.NOT_FOUND,
    );
  });
});
