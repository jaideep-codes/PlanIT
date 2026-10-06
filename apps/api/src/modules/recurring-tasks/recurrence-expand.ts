import type { Options } from 'rrule';
import rrule from 'rrule';

import { parseRecurrenceRule, type CanonicalRecurrence } from './recurrence-rule.js';

const { RRule, datetime } = rrule;

const WEEKDAY = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
} as const;

function utcDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return datetime(year ?? 0, month ?? 0, day ?? 0);
}

function isoFromUtc(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Expands a canonical rule as UTC calendar dates. `rrule` is not given a `tzid`;
 * timezone conversion of a start minute lives in `recurrence-time.ts` (decision D-041).
 */
function optionsFor(
  rule: CanonicalRecurrence,
  startDate: string,
  endDate: string | null,
): Partial<Options> {
  const base: Partial<Options> = {
    interval: rule.interval,
    dtstart: utcDate(startDate),
    wkst: WEEKDAY[rule.wkst],
    ...(endDate !== null ? { until: utcDate(endDate) } : {}),
  };
  if (rule.byMonthDay !== null) {
    return { ...base, freq: RRule.MONTHLY, bymonthday: rule.byMonthDay };
  }
  if (rule.byDay.length > 0) {
    return { ...base, freq: RRule.WEEKLY, byweekday: rule.byDay.map((day) => WEEKDAY[day]) };
  }
  return { ...base, freq: RRule.DAILY };
}

/** Dates the rule produces inside the inclusive window, also bounded by the series. */
export function expandOccurrenceDates(input: {
  recurrenceRule: string;
  startDate: string;
  endDate: string | null;
  from: string;
  to: string;
}): string[] {
  if (input.from > input.to) return [];
  const rule = parseRecurrenceRule(input.recurrenceRule);
  const from = input.from < input.startDate ? input.startDate : input.from;
  const endCap = input.endDate;
  const to = endCap !== null && input.to > endCap ? endCap : input.to;
  if (from > to) return [];
  const matches = new RRule(optionsFor(rule, input.startDate, input.endDate)).between(
    utcDate(from),
    utcDate(to),
    true,
  );
  return matches.map(isoFromUtc).filter((date) => {
    if (date < input.startDate || date < input.from || date > input.to) return false;
    return input.endDate === null || date <= input.endDate;
  });
}
