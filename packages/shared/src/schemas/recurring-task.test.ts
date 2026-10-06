import { describe, expect, it } from 'vitest';

import {
  createRecurringTaskRequestSchema,
  occurrenceRangeQuerySchema,
  updateRecurringTaskRequestSchema,
} from './recurring-task.js';

const START = '2026-01-05';

describe('recurring task request schemas', () => {
  it('accepts each frequency and rejects a raw rule, userId, and a start minute without an estimate', () => {
    expect(
      createRecurringTaskRequestSchema.parse({
        title: '  Standup  ',
        frequency: 'DAILY',
        interval: 1,
        startDate: START,
      }),
    ).toMatchObject({ title: 'Standup', frequency: 'DAILY', interval: 1 });
    expect(
      createRecurringTaskRequestSchema.parse({
        title: 'Weekdays',
        frequency: 'WEEKDAYS',
        interval: 1,
        byDay: ['SU'],
        startDate: START,
      }).byDay,
    ).toEqual(['SU']);
    expect(
      createRecurringTaskRequestSchema.safeParse({
        title: 'Plan',
        frequency: 'DAILY',
        interval: 1,
        startDate: START,
        recurrenceRule: 'FREQ=DAILY',
      }).success,
    ).toBe(false);
    expect(
      createRecurringTaskRequestSchema.safeParse({
        title: 'Plan',
        frequency: 'DAILY',
        interval: 1,
        startDate: START,
        userId: '01990000-0000-7000-8000-000000000001',
      }).success,
    ).toBe(false);
    expect(
      createRecurringTaskRequestSchema.safeParse({
        title: 'Plan',
        frequency: 'DAILY',
        interval: 1,
        startDate: START,
        defaultStartMinute: 90,
      }).success,
    ).toBe(false);
    expect(
      createRecurringTaskRequestSchema.safeParse({
        title: 'Plan',
        frequency: 'CUSTOM',
        interval: 1,
        startDate: START,
      }).success,
    ).toBe(false);
    expect(
      createRecurringTaskRequestSchema.parse({
        title: 'Plan',
        frequency: 'CUSTOM',
        interval: 2,
        startDate: START,
        estimatedMinutes: 30,
        defaultStartMinute: 90,
      }),
    ).toMatchObject({ interval: 2, defaultStartMinute: 90 });
  });

  it('rejects a range that starts after it ends or is longer than 62 days', () => {
    expect(
      occurrenceRangeQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success,
    ).toBe(false);
    expect(occurrenceRangeQuerySchema.parse({ from: '2026-01-01', to: '2026-03-03' })).toEqual({
      from: '2026-01-01',
      to: '2026-03-03',
    });
    expect(
      occurrenceRangeQuerySchema.safeParse({ from: '2026-01-01', to: '2026-03-04' }).success,
    ).toBe(false);
  });

  it('requires a full rule when a patch changes one, and rejects userId', () => {
    expect(updateRecurringTaskRequestSchema.parse({ title: ' Next ' })).toEqual({ title: 'Next' });
    expect(updateRecurringTaskRequestSchema.safeParse({}).success).toBe(false);
    expect(updateRecurringTaskRequestSchema.safeParse({ byDay: ['MO'] }).success).toBe(false);
    expect(
      updateRecurringTaskRequestSchema.safeParse({
        title: 'Next',
        userId: '01990000-0000-7000-8000-000000000001',
      }).success,
    ).toBe(false);
    expect(
      updateRecurringTaskRequestSchema.parse({
        frequency: 'WEEKLY',
        interval: 1,
        byDay: ['FR', 'MO'],
      }),
    ).toMatchObject({ frequency: 'WEEKLY', interval: 1 });
  });
});
