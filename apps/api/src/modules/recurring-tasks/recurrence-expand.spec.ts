import { describe, expect, it } from 'vitest';

import { expandOccurrenceDates } from './recurrence-expand.js';
import { buildRecurrenceRule } from './recurrence-rule.js';

function rule(
  frequency: 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM',
  extra: {
    interval?: number;
    byDay?: Array<'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'>;
    byMonthDay?: number;
    startDate: string;
  },
): string {
  return buildRecurrenceRule({
    frequency,
    interval: extra.interval ?? 1,
    byDay: extra.byDay,
    byMonthDay: extra.byMonthDay,
    startDate: extra.startDate,
    wkst: 'MO',
  }).recurrenceRule;
}

describe('recurrence expansion', () => {
  it('expands daily, weekdays, weekly, monthly, and a custom interval', () => {
    expect(
      expandOccurrenceDates({
        recurrenceRule: rule('DAILY', { startDate: '2026-01-01' }),
        startDate: '2026-01-01',
        endDate: '2026-01-03',
        from: '2026-01-01',
        to: '2026-01-03',
      }),
    ).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);

    expect(
      expandOccurrenceDates({
        recurrenceRule: rule('WEEKDAYS', { startDate: '2026-01-05' }),
        startDate: '2026-01-05',
        endDate: '2026-01-11',
        from: '2026-01-05',
        to: '2026-01-11',
      }),
    ).toEqual(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']);

    expect(
      expandOccurrenceDates({
        recurrenceRule: rule('WEEKLY', { byDay: ['MO', 'WE'], startDate: '2026-01-05' }),
        startDate: '2026-01-05',
        endDate: '2026-01-14',
        from: '2026-01-05',
        to: '2026-01-14',
      }),
    ).toEqual(['2026-01-05', '2026-01-07', '2026-01-12', '2026-01-14']);

    expect(
      expandOccurrenceDates({
        recurrenceRule: rule('MONTHLY', { byMonthDay: 15, startDate: '2026-01-15' }),
        startDate: '2026-01-15',
        endDate: '2026-03-15',
        from: '2026-01-01',
        to: '2026-03-31',
      }),
    ).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);

    expect(
      expandOccurrenceDates({
        recurrenceRule: rule('CUSTOM', { interval: 2, startDate: '2026-01-01' }),
        startDate: '2026-01-01',
        endDate: null,
        from: '2026-01-01',
        to: '2026-01-07',
      }),
    ).toEqual(['2026-01-01', '2026-01-03', '2026-01-05', '2026-01-07']);
  });

  it('skips a month that has no 31st and still produces 31 March', () => {
    expect(
      expandOccurrenceDates({
        recurrenceRule: rule('MONTHLY', { startDate: '2026-01-31' }),
        startDate: '2026-01-31',
        endDate: '2026-03-31',
        from: '2026-01-01',
        to: '2026-03-31',
      }),
    ).toEqual(['2026-01-31', '2026-03-31']);
  });

  it('treats endDate as inclusive and ignores dates before startDate', () => {
    const recurrenceRule = rule('DAILY', { startDate: '2026-01-02' });
    expect(
      expandOccurrenceDates({
        recurrenceRule,
        startDate: '2026-01-02',
        endDate: '2026-01-03',
        from: '2026-01-01',
        to: '2026-01-10',
      }),
    ).toEqual(['2026-01-02', '2026-01-03']);
  });
});
