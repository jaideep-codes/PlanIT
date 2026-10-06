import { describe, expect, it } from 'vitest';

import { scheduleForOccurrence } from './recurrence-time.js';

describe('occurrence schedule times', () => {
  it('leaves the schedule empty when America/New_York skips 02:30 on 2026-03-08', () => {
    expect(
      scheduleForOccurrence({
        occurrenceDate: '2026-03-08',
        timeZone: 'America/New_York',
        defaultStartMinute: 2 * 60 + 30,
        estimatedMinutes: 30,
      }),
    ).toEqual({ scheduledStart: null, scheduledEnd: null });
  });

  it('uses the earlier America/New_York instant when 01:30 happens twice on 2026-11-01', () => {
    const schedule = scheduleForOccurrence({
      occurrenceDate: '2026-11-01',
      timeZone: 'America/New_York',
      defaultStartMinute: 1 * 60 + 30,
      estimatedMinutes: 30,
    });
    expect(schedule.scheduledStart?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(schedule.scheduledEnd?.toISOString()).toBe('2026-11-01T06:00:00.000Z');
  });
});
