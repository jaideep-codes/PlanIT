import type { RecurrenceFrequency, RecurrenceWeekday } from '@planit/types';

export const WEEKDAY_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR'] as const satisfies readonly RecurrenceWeekday[];

const WKST_BY_WEEK_START = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const RULE_MAX = 500;

export class InvalidRecurrenceRuleError extends Error {
  constructor() {
    super('The recurrence rule is invalid.');
    this.name = 'InvalidRecurrenceRuleError';
  }
}

export interface StructuredRecurrence {
  frequency: RecurrenceFrequency;
  interval: number;
  byDay: RecurrenceWeekday[];
  byMonthDay: number | null;
}

export interface CanonicalRecurrence extends StructuredRecurrence {
  recurrenceRule: string;
  wkst: RecurrenceWeekday;
}

export interface RuleInput {
  frequency: RecurrenceFrequency;
  interval: number;
  byDay?: readonly RecurrenceWeekday[] | undefined;
  byMonthDay?: number | null | undefined;
  startDate: string;
  wkst: RecurrenceWeekday;
}

/** Drops empty day lists so a stored daily or monthly rule can be rewritten. */
export function ruleInputFromStructured(
  rule: StructuredRecurrence,
  startDate: string,
  wkst: RecurrenceWeekday,
): RuleInput {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    ...(rule.byDay.length > 0 ? { byDay: rule.byDay } : {}),
    ...(rule.byMonthDay !== null ? { byMonthDay: rule.byMonthDay } : {}),
    startDate,
    wkst,
  };
}

export function wkstFromWeekStartsOn(weekStartsOn: number): RecurrenceWeekday {
  const wkst = WKST_BY_WEEK_START[weekStartsOn];
  if (wkst === undefined) throw new InvalidRecurrenceRuleError();
  return wkst;
}

function dayOf(isoDate: string): number {
  const day = Number(isoDate.slice(8, 10));
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new InvalidRecurrenceRuleError();
  return day;
}

function canonicalDays(days: readonly RecurrenceWeekday[]): RecurrenceWeekday[] {
  if (new Set(days).size !== days.length) throw new InvalidRecurrenceRuleError();
  const selected = new Set(days);
  return WEEKDAY_ORDER.filter((day) => selected.has(day));
}

function sameDays(
  left: readonly RecurrenceWeekday[],
  right: readonly RecurrenceWeekday[],
): boolean {
  return left.length === right.length && left.every((day, index) => day === right[index]);
}

function hasMonthDay(value: number | null | undefined): value is number {
  return value !== undefined && value !== null;
}

/**
 * Writes one canonical RRULE. Weekday order is Monday through Sunday, `WKST` is last,
 * and interval is always present. A weekly Monday–Friday rule is stored as `WEEKDAYS`.
 */
export function buildRecurrenceRule(input: RuleInput): CanonicalRecurrence {
  const wkst = input.wkst;
  let frequency = input.frequency;
  const interval = input.interval;
  let byDay: RecurrenceWeekday[] = [];
  let byMonthDay: number | null = null;

  if (frequency === 'DAILY') {
    if (interval !== 1 || input.byDay !== undefined || hasMonthDay(input.byMonthDay)) {
      throw new InvalidRecurrenceRuleError();
    }
  } else if (frequency === 'WEEKDAYS') {
    if (interval !== 1 || hasMonthDay(input.byMonthDay)) throw new InvalidRecurrenceRuleError();
    byDay = [...WEEKDAYS];
  } else if (frequency === 'WEEKLY') {
    if (interval !== 1 || input.byDay === undefined || hasMonthDay(input.byMonthDay)) {
      throw new InvalidRecurrenceRuleError();
    }
    byDay = canonicalDays(input.byDay);
    if (byDay.length === 0) throw new InvalidRecurrenceRuleError();
    if (sameDays(byDay, WEEKDAYS)) frequency = 'WEEKDAYS';
  } else if (frequency === 'MONTHLY') {
    if (interval !== 1 || input.byDay !== undefined) throw new InvalidRecurrenceRuleError();
    byMonthDay = input.byMonthDay ?? dayOf(input.startDate);
  } else if (input.byDay !== undefined && hasMonthDay(input.byMonthDay)) {
    throw new InvalidRecurrenceRuleError();
  } else if (input.byDay !== undefined) {
    if (interval < 2 || interval > 52) throw new InvalidRecurrenceRuleError();
    byDay = canonicalDays(input.byDay);
    if (byDay.length === 0) throw new InvalidRecurrenceRuleError();
  } else if (hasMonthDay(input.byMonthDay)) {
    if (interval < 2 || interval > 12) throw new InvalidRecurrenceRuleError();
    byMonthDay = input.byMonthDay;
  } else if (interval < 2 || interval > 99) {
    throw new InvalidRecurrenceRuleError();
  }

  const parts = [`FREQ=${freqOf(frequency, byDay, byMonthDay)}`, `INTERVAL=${interval}`];
  if (byDay.length > 0) parts.push(`BYDAY=${byDay.join(',')}`);
  if (byMonthDay !== null) parts.push(`BYMONTHDAY=${byMonthDay}`);
  parts.push(`WKST=${wkst}`);
  const recurrenceRule = parts.join(';');
  if (recurrenceRule.length > RULE_MAX) throw new InvalidRecurrenceRuleError();
  return { frequency, interval, byDay, byMonthDay, recurrenceRule, wkst };
}

function freqOf(
  frequency: RecurrenceFrequency,
  byDay: readonly RecurrenceWeekday[],
  byMonthDay: number | null,
): 'DAILY' | 'WEEKLY' | 'MONTHLY' {
  if (frequency === 'DAILY') return 'DAILY';
  if (frequency === 'MONTHLY') return 'MONTHLY';
  if (frequency === 'CUSTOM' && byMonthDay !== null) return 'MONTHLY';
  if (frequency === 'CUSTOM' && byDay.length === 0) return 'DAILY';
  return 'WEEKLY';
}

const DAILY_RULE = /^FREQ=DAILY;INTERVAL=(\d{1,2});WKST=(SU|MO|TU|WE|TH|FR|SA)$/;
const WEEKLY_RULE =
  /^FREQ=WEEKLY;INTERVAL=(\d{1,2});BYDAY=((?:SU|MO|TU|WE|TH|FR|SA)(?:,(?:SU|MO|TU|WE|TH|FR|SA))*);WKST=(SU|MO|TU|WE|TH|FR|SA)$/;
const MONTHLY_RULE =
  /^FREQ=MONTHLY;INTERVAL=(\d{1,2});BYMONTHDAY=(\d{1,2});WKST=(SU|MO|TU|WE|TH|FR|SA)$/;

function asWkst(value: string): RecurrenceWeekday {
  if (
    value === 'SU' ||
    value === 'MO' ||
    value === 'TU' ||
    value === 'WE' ||
    value === 'TH' ||
    value === 'FR' ||
    value === 'SA'
  ) {
    return value;
  }
  throw new InvalidRecurrenceRuleError();
}

function parseDays(value: string): RecurrenceWeekday[] {
  const days = value.split(',').map(asWkst);
  const canonical = canonicalDays(days);
  if (!sameDays(days, canonical)) throw new InvalidRecurrenceRuleError();
  return canonical;
}

/** Accepts only a string `buildRecurrenceRule` would write. */
export function parseRecurrenceRule(rule: string): CanonicalRecurrence {
  if (rule.length < 1 || rule.length > RULE_MAX) throw new InvalidRecurrenceRuleError();
  const daily = DAILY_RULE.exec(rule);
  if (daily) {
    const interval = Number(daily[1]);
    const wkst = asWkst(daily[2] ?? '');
    if (interval === 1) {
      return {
        frequency: 'DAILY',
        interval,
        byDay: [],
        byMonthDay: null,
        recurrenceRule: rule,
        wkst,
      };
    }
    if (interval >= 2 && interval <= 99) {
      return {
        frequency: 'CUSTOM',
        interval,
        byDay: [],
        byMonthDay: null,
        recurrenceRule: rule,
        wkst,
      };
    }
    throw new InvalidRecurrenceRuleError();
  }
  const weekly = WEEKLY_RULE.exec(rule);
  if (weekly) {
    const interval = Number(weekly[1]);
    const byDay = parseDays(weekly[2] ?? '');
    const wkst = asWkst(weekly[3] ?? '');
    if (interval === 1 && sameDays(byDay, WEEKDAYS)) {
      return {
        frequency: 'WEEKDAYS',
        interval,
        byDay,
        byMonthDay: null,
        recurrenceRule: rule,
        wkst,
      };
    }
    if (interval === 1) {
      return { frequency: 'WEEKLY', interval, byDay, byMonthDay: null, recurrenceRule: rule, wkst };
    }
    if (interval >= 2 && interval <= 52) {
      return { frequency: 'CUSTOM', interval, byDay, byMonthDay: null, recurrenceRule: rule, wkst };
    }
    throw new InvalidRecurrenceRuleError();
  }
  const monthly = MONTHLY_RULE.exec(rule);
  if (monthly) {
    const interval = Number(monthly[1]);
    const byMonthDay = Number(monthly[2]);
    const wkst = asWkst(monthly[3] ?? '');
    if (byMonthDay < 1 || byMonthDay > 31) throw new InvalidRecurrenceRuleError();
    if (interval === 1) {
      return { frequency: 'MONTHLY', interval, byDay: [], byMonthDay, recurrenceRule: rule, wkst };
    }
    if (interval >= 2 && interval <= 12) {
      return { frequency: 'CUSTOM', interval, byDay: [], byMonthDay, recurrenceRule: rule, wkst };
    }
  }
  throw new InvalidRecurrenceRuleError();
}
