import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * Timezone and calendar-day math for recurrence. Node 24.19 does not expose `Temporal`
 * without a flag, so this module uses `date-fns-tz` only. `rrule` does not take a `tzid`
 * (decision D-041).
 */

const LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm:ss";

export interface OccurrenceSchedule {
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
}

export function calendarDateInTimeZone(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, 'yyyy-MM-dd');
}

/** Adds Gregorian days to a `YYYY-MM-DD` date. The value is a calendar date, not an instant. */
export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error('Invalid calendar date.');
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function earlierInstant(utc: Date, local: string, timeZone: string): Date {
  let earliest = utc;
  for (let delta = -180; delta <= 180; delta += 1) {
    const candidate = new Date(utc.getTime() + delta * 60_000);
    if (formatInTimeZone(candidate, timeZone, LOCAL_FORMAT) !== local) continue;
    if (candidate.getTime() < earliest.getTime()) earliest = candidate;
  }
  return earliest;
}

/**
 * A missing local time (spring-forward gap) yields both columns null. A repeated local
 * time (fall-back overlap) uses the earlier instant. The estimate is an absolute duration.
 */
export function scheduleForOccurrence(input: {
  occurrenceDate: string;
  timeZone: string;
  defaultStartMinute: number | null;
  estimatedMinutes: number | null;
}): OccurrenceSchedule {
  if (input.defaultStartMinute === null || input.estimatedMinutes === null) {
    return { scheduledStart: null, scheduledEnd: null };
  }
  const hour = Math.floor(input.defaultStartMinute / 60);
  const minute = input.defaultStartMinute % 60;
  const local = `${input.occurrenceDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const utc = fromZonedTime(local, input.timeZone);
  if (formatInTimeZone(utc, input.timeZone, LOCAL_FORMAT) !== local) {
    return { scheduledStart: null, scheduledEnd: null };
  }
  const scheduledStart = earlierInstant(utc, local, input.timeZone);
  return {
    scheduledStart,
    scheduledEnd: new Date(scheduledStart.getTime() + input.estimatedMinutes * 60_000),
  };
}
