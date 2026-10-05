import { describe, expect, it } from 'vitest';

import { taskPageOrderBy, taskPageWhere } from './task-query.js';

const USER = '01990000-0000-7000-8000-000000000010';
const ID = '01990000-0000-7000-8000-000000000011';

describe('task page query', () => {
  it('scopes every page by the caller and keeps filters in one where clause', () => {
    expect(
      taskPageWhere(
        USER,
        { status: ['TODO', 'COMPLETED'], priority: ['HIGH'], due: '2026-10-05' },
        { field: 'manual', descending: false },
        null,
      ),
    ).toEqual({
      AND: [
        { userId: USER },
        {
          status: { in: ['TODO', 'COMPLETED'] },
          priority: { in: ['HIGH'] },
          dueDate: new Date(Date.UTC(2026, 9, 5)),
        },
      ],
    });
  });

  it('orders priority high-first and continues a manual cursor after the last key', () => {
    expect(taskPageOrderBy({ field: 'priority', descending: false })).toEqual([
      { priority: 'desc' },
      { id: 'asc' },
    ]);
    expect(taskPageOrderBy({ field: 'dueDate', descending: false })).toEqual([
      { dueDate: { sort: 'asc', nulls: 'last' } },
      { id: 'asc' },
    ]);
    expect(
      taskPageWhere(USER, {}, { field: 'manual', descending: false }, { id: ID, key: 'a0' }),
    ).toEqual({
      AND: [
        { userId: USER },
        {},
        { OR: [{ sortOrder: { gt: 'a0' } }, { sortOrder: 'a0', id: { gt: ID } }] },
      ],
    });
    expect(
      taskPageWhere(USER, {}, { field: 'priority', descending: false }, { id: ID, key: 'HIGH' }),
    ).toEqual({
      AND: [
        { userId: USER },
        {},
        {
          OR: [{ priority: 'HIGH', id: { gt: ID } }, { priority: { in: ['MEDIUM', 'LOW'] } }],
        },
      ],
    });
  });
});
