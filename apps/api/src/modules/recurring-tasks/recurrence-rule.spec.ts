import { describe, expect, it } from 'vitest';

import {
  InvalidRecurrenceRuleError,
  buildRecurrenceRule,
  parseRecurrenceRule,
  wkstFromWeekStartsOn,
} from './recurrence-rule.js';

describe('recurrence rules', () => {
  it('writes a canonical rule and reads the same structured fields back', () => {
    const daily = buildRecurrenceRule({
      frequency: 'DAILY',
      interval: 1,
      startDate: '2026-01-01',
      wkst: 'MO',
    });
    expect(daily.recurrenceRule).toBe('FREQ=DAILY;INTERVAL=1;WKST=MO');
    expect(parseRecurrenceRule(daily.recurrenceRule)).toMatchObject({
      frequency: 'DAILY',
      interval: 1,
      byDay: [],
      byMonthDay: null,
    });

    const weekdays = buildRecurrenceRule({
      frequency: 'WEEKDAYS',
      interval: 1,
      byDay: ['SU'],
      startDate: '2026-01-05',
      wkst: 'MO',
    });
    expect(weekdays.recurrenceRule).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;WKST=MO');
    expect(parseRecurrenceRule(weekdays.recurrenceRule).frequency).toBe('WEEKDAYS');

    const weekly = buildRecurrenceRule({
      frequency: 'WEEKLY',
      interval: 1,
      byDay: ['WE', 'MO'],
      startDate: '2026-01-05',
      wkst: 'SU',
    });
    expect(weekly.recurrenceRule).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;WKST=SU');

    const monthly = buildRecurrenceRule({
      frequency: 'MONTHLY',
      interval: 1,
      startDate: '2026-01-31',
      wkst: 'MO',
    });
    expect(monthly.recurrenceRule).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31;WKST=MO');
    expect(monthly.byMonthDay).toBe(31);

    const custom = buildRecurrenceRule({
      frequency: 'CUSTOM',
      interval: 2,
      startDate: '2026-01-01',
      wkst: wkstFromWeekStartsOn(0),
    });
    expect(custom.recurrenceRule).toBe('FREQ=DAILY;INTERVAL=2;WKST=SU');
    expect(parseRecurrenceRule(custom.recurrenceRule).frequency).toBe('CUSTOM');
  });

  it('rejects rules the server did not write', () => {
    for (const rule of [
      'FREQ=YEARLY;INTERVAL=1;WKST=MO',
      'FREQ=HOURLY;INTERVAL=1;WKST=MO',
      'FREQ=MINUTELY;INTERVAL=1;WKST=MO',
      'FREQ=SECONDLY;INTERVAL=1;WKST=MO',
      'FREQ=DAILY;INTERVAL=1;COUNT=5;WKST=MO',
      'FREQ=DAILY;WKST=MO',
      'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE,MO;WKST=MO',
      'WKST=MO;FREQ=DAILY;INTERVAL=1',
    ]) {
      expect(() => parseRecurrenceRule(rule)).toThrow(InvalidRecurrenceRuleError);
    }
  });
});
