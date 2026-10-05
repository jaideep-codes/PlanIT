import { describe, expect, it } from 'vitest';

import {
  createTaskRequestSchema,
  listTasksQuerySchema,
  repositionTaskRequestSchema,
  updateTaskRequestSchema,
} from './task.js';

const START = '2026-10-05T09:00:00.000Z';
const END = '2026-10-05T10:00:00.000Z';

describe('task request schemas', () => {
  it('trims the title, defaults nothing the client omitted, and drops blank notes', () => {
    expect(createTaskRequestSchema.parse({ title: '  Ship it  ', notes: '   ' })).toEqual({
      title: 'Ship it',
      notes: null,
    });
    expect(
      createTaskRequestSchema.parse({
        title: 'Plan',
        notes: '  keep  ',
        priority: 'HIGH',
        dueDate: '2026-10-05',
        scheduledStart: START,
        scheduledEnd: END,
        estimatedMinutes: 30,
      }),
    ).toMatchObject({ notes: 'keep', priority: 'HIGH', estimatedMinutes: 30 });
  });

  it('rejects unknown keys, a partial schedule, a backwards schedule, and a bad estimate', () => {
    expect(createTaskRequestSchema.safeParse({ title: 'Plan', userId: 'x' }).success).toBe(false);
    expect(createTaskRequestSchema.safeParse({ title: 'Plan', status: 'TODO' }).success).toBe(
      false,
    );
    expect(createTaskRequestSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({ title: 'Plan', scheduledStart: START }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({
        title: 'Plan',
        scheduledStart: END,
        scheduledEnd: START,
      }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({
        title: 'Plan',
        scheduledStart: START,
        scheduledEnd: START,
      }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.parse({
        title: 'Plan',
        scheduledStart: null,
        scheduledEnd: null,
        estimatedMinutes: null,
        dueDate: null,
      }),
    ).toMatchObject({ scheduledStart: null, estimatedMinutes: null });
    expect(createTaskRequestSchema.safeParse({ title: 'Plan', estimatedMinutes: 0 }).success).toBe(
      false,
    );
    expect(
      createTaskRequestSchema.safeParse({ title: 'Plan', estimatedMinutes: 10081 }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({ title: 'Plan', estimatedMinutes: 1.5 }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.safeParse({ title: 'Plan', dueDate: '2026-02-31' }).success,
    ).toBe(false);
    expect(
      createTaskRequestSchema.parse({ title: 'Plan', estimatedMinutes: 10080 }).estimatedMinutes,
    ).toBe(10080);
  });

  it('lets a patch set editable fields and rejects completion, order, and identity', () => {
    expect(
      updateTaskRequestSchema.parse({
        title: ' Next ',
        notes: '',
        status: 'IN_PROGRESS',
        priority: 'LOW',
      }),
    ).toEqual({ title: 'Next', notes: null, status: 'IN_PROGRESS', priority: 'LOW' });
    expect(updateTaskRequestSchema.safeParse({}).success).toBe(false);
    for (const body of [
      { status: 'COMPLETED' },
      { completedAt: START },
      { sortOrder: 'a0' },
      { userId: 'x' },
      { id: '01990000-0000-7000-8000-000000000001' },
      { title: 'Next', extra: true },
    ]) {
      expect(updateTaskRequestSchema.safeParse(body).success).toBe(false);
    }
    expect(updateTaskRequestSchema.safeParse({ scheduledEnd: END }).success).toBe(false);
  });

  it('requires a neighbor id and rejects unknown position fields', () => {
    const id = '01990000-0000-7000-8000-000000000001';
    expect(repositionTaskRequestSchema.parse({ beforeId: id })).toEqual({ beforeId: id });
    expect(repositionTaskRequestSchema.parse({ afterId: id })).toEqual({ afterId: id });
    expect(repositionTaskRequestSchema.safeParse({}).success).toBe(false);
    expect(repositionTaskRequestSchema.safeParse({ beforeId: id, afterId: id }).success).toBe(
      false,
    );
    expect(repositionTaskRequestSchema.safeParse({ beforeId: id, sortOrder: 'a0' }).success).toBe(
      false,
    );
    expect(repositionTaskRequestSchema.safeParse({ userId: id }).success).toBe(false);
  });

  it('parses an explicit list query and rejects unknown keys', () => {
    expect(listTasksQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(
      listTasksQuerySchema.parse({
        limit: '2',
        status: ['TODO', 'TODO', 'COMPLETED'],
        priority: 'HIGH',
        due: '2026-10-05',
        scheduledFrom: START,
        scheduledTo: END,
        sort: '-priority',
        cursor: 'abc',
      }),
    ).toEqual({
      limit: 2,
      status: ['TODO', 'COMPLETED'],
      priority: ['HIGH'],
      due: '2026-10-05',
      scheduledFrom: START,
      scheduledTo: END,
      sort: '-priority',
      cursor: 'abc',
    });
    expect(listTasksQuerySchema.safeParse({ userId: 'x' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ sort: 'title' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ status: 'DONE' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ scheduledFrom: END, scheduledTo: START }).success).toBe(
      false,
    );
  });
});
