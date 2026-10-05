import { describe, expect, it } from 'vitest';

import { taskListPath } from './task-list-query';

describe('taskListPath', () => {
  it('repeats status and omits sort until the caller has one', () => {
    expect(
      taskListPath({
        status: ['TODO', 'IN_PROGRESS'],
      }),
    ).toBe('/v1/tasks?status=TODO&status=IN_PROGRESS');
  });

  it('sends the same filters with a cursor and an explicit sort', () => {
    expect(
      taskListPath({
        status: ['TODO', 'IN_PROGRESS', 'COMPLETED'],
        priority: 'HIGH',
        due: '2026-10-05',
        sort: '-manual',
        cursor: 'cursor-1',
      }),
    ).toBe(
      '/v1/tasks?status=TODO&status=IN_PROGRESS&status=COMPLETED&priority=HIGH&due=2026-10-05&sort=-manual&cursor=cursor-1',
    );
  });
});
