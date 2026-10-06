import type { TaskPriority } from './task.js';

/** Structured recurrence. `CUSTOM` is a daily, weekly, or monthly interval above 1. */
export type RecurrenceFrequency = 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

/** RFC 5545 weekday. Canonical order is Monday through Sunday. */
export type RecurrenceWeekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

/**
 * Owner-only series projection. `userId` is not part of this contract.
 * `recurrenceRule` is the canonical RRULE the server wrote from the structured fields.
 * Dates are `YYYY-MM-DD` in the series timezone. Timestamps are ISO 8601 UTC.
 */
export interface RecurringTask {
  id: string;
  title: string;
  notes: string | null;
  priority: TaskPriority;
  frequency: RecurrenceFrequency;
  interval: number;
  byDay: RecurrenceWeekday[];
  byMonthDay: number | null;
  recurrenceRule: string;
  startDate: string;
  endDate: string | null;
  timezone: string;
  enabled: boolean;
  estimatedMinutes: number | null;
  defaultStartMinute: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Cursor page of the caller's series, newest `createdAt` first. */
export interface RecurringTaskList {
  items: RecurringTask[];
  nextCursor: string | null;
}

/**
 * A date the generator must not create again. `PENDING` is reserved and is not stored
 * for a future horizon. `userId` is not part of this contract.
 */
export type OccurrenceStatus = 'PENDING' | 'MATERIALIZED' | 'SKIPPED' | 'COMPLETED';

export interface TaskOccurrence {
  id: string;
  recurringTaskId: string;
  taskId: string | null;
  occurrenceDate: string;
  status: OccurrenceStatus;
  createdAt: string;
}

/** Every occurrence row in a requested date range. `nextCursor` is null; the range is capped. */
export interface TaskOccurrenceList {
  items: TaskOccurrence[];
  nextCursor: string | null;
}
