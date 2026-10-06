import type { Task } from '@planit/types';
import { describe, expect, it } from 'vitest';

import { BadTaskCursorError, decodeTaskCursor, encodeTaskCursor } from './task-cursor.js';

const TASK: Task = {
  id: '01990000-0000-7000-8000-000000000021',
  title: 'Plan',
  notes: null,
  priority: 'HIGH',
  status: 'TODO',
  dueDate: '2026-10-05',
  scheduledStart: null,
  scheduledEnd: null,
  estimatedMinutes: null,
  completedAt: null,
  sortOrder: 'a0',
  recurringTaskId: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
};

const SORT = { field: 'manual' as const, descending: false };
const FILTERS = { status: ['TODO' as const] };

describe('task cursors', () => {
  it('round-trips the sort key and id for the same query', () => {
    const encoded = encodeTaskCursor(TASK, FILTERS, SORT);
    expect(encoded).not.toContain(TASK.title);
    expect(decodeTaskCursor(encoded, FILTERS, SORT)).toEqual({ id: TASK.id, key: 'a0' });
    expect(
      decodeTaskCursor(
        encodeTaskCursor(TASK, FILTERS, { field: 'dueDate', descending: false }),
        {
          status: ['TODO'],
        },
        { field: 'dueDate', descending: false },
      ),
    ).toEqual({ id: TASK.id, key: '2026-10-05' });
  });

  it('rejects a cursor that is malformed or belongs to a different query', () => {
    const encoded = encodeTaskCursor(TASK, FILTERS, SORT);
    expect(() => decodeTaskCursor('@@@', FILTERS, SORT)).toThrow(BadTaskCursorError);
    expect(() => decodeTaskCursor(encoded, {}, SORT)).toThrow(BadTaskCursorError);
    expect(() =>
      decodeTaskCursor(encoded, FILTERS, { field: 'priority', descending: false }),
    ).toThrow(BadTaskCursorError);
    const payload = Buffer.from(
      JSON.stringify({ q: 'x', id: TASK.id, key: null }),
      'utf8',
    ).toString('base64url');
    expect(() => decodeTaskCursor(payload, FILTERS, SORT)).toThrow(BadTaskCursorError);
  });
});
