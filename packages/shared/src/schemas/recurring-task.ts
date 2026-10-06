import type {
  RecurrenceFrequency,
  RecurrenceWeekday,
  RecurringTask,
  RecurringTaskList,
  TaskOccurrence,
  TaskOccurrenceList,
} from '@planit/types';
import { z } from 'zod';

import { timezoneSchema } from './user.js';
import {
  calendarDateSchema,
  estimatedMinutesSchema,
  taskNotesSchema,
  taskPrioritySchema,
  taskTitleSchema,
} from './task.js';

export const RECURRENCE_FREQUENCIES = [
  'DAILY',
  'WEEKDAYS',
  'WEEKLY',
  'MONTHLY',
  'CUSTOM',
] as const satisfies readonly RecurrenceFrequency[];

export const RECURRENCE_WEEKDAYS = [
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
  'SU',
] as const satisfies readonly RecurrenceWeekday[];

export const OCCURRENCE_STATUSES = [
  'PENDING',
  'MATERIALIZED',
  'SKIPPED',
  'COMPLETED',
] as const satisfies readonly TaskOccurrence['status'][];

const frequencySchema = z.enum(RECURRENCE_FREQUENCIES);
const byDaySchema = z.array(z.enum(RECURRENCE_WEEKDAYS)).min(1).max(7);
const byMonthDaySchema = z
  .number()
  .int('Enter a day of the month.')
  .min(1, 'Day of the month must be from 1 to 31.')
  .max(31, 'Day of the month must be from 1 to 31.');
const intervalSchema = z.number().int('Enter a whole-number interval.').min(1).max(99);
const startMinuteSchema = z
  .number()
  .int('Enter a whole-number start minute.')
  .min(0, 'Start minute must be from 0 to 1439.')
  .max(1439, 'Start minute must be from 0 to 1439.');

const limitSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'limit must be an integer from 1 to 100.')
  .transform(Number)
  .pipe(z.number().int().min(1).max(100, 'limit must be an integer from 1 to 100.'))
  .optional()
  .default(20);

interface RuleFields {
  frequency?: RecurrenceFrequency;
  interval?: number;
  byDay?: RecurrenceWeekday[];
  byMonthDay?: number;
  startDate?: string;
  endDate?: string | null;
  estimatedMinutes?: number | null;
  defaultStartMinute?: number | null;
}

function inclusiveDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

function addRuleIssue(ctx: z.RefinementCtx, message: string): void {
  ctx.addIssue({ code: 'custom', message });
}

/** Shared by create and by a patch that replaces the rule. */
function refineStructuredRule(value: RuleFields, ctx: z.RefinementCtx): void {
  if (value.byDay && new Set(value.byDay).size !== value.byDay.length) {
    addRuleIssue(ctx, 'List each weekday once.');
    return;
  }
  const frequency = value.frequency;
  const interval = value.interval;
  if (frequency === undefined || interval === undefined) {
    addRuleIssue(ctx, 'Send frequency and interval together.');
    return;
  }
  if (frequency === 'DAILY') {
    if (interval !== 1) addRuleIssue(ctx, 'Daily recurrence uses an interval of 1.');
    if (value.byDay !== undefined) addRuleIssue(ctx, 'Daily recurrence does not take weekdays.');
    if (value.byMonthDay !== undefined)
      addRuleIssue(ctx, 'Daily recurrence does not take a month day.');
    return;
  }
  if (frequency === 'WEEKDAYS') {
    if (interval !== 1) addRuleIssue(ctx, 'Weekday recurrence uses an interval of 1.');
    if (value.byMonthDay !== undefined) {
      addRuleIssue(ctx, 'Weekday recurrence does not take a month day.');
    }
    return;
  }
  if (frequency === 'WEEKLY') {
    if (interval !== 1) addRuleIssue(ctx, 'Weekly recurrence uses an interval of 1.');
    if (value.byDay === undefined)
      addRuleIssue(ctx, 'Weekly recurrence needs at least one weekday.');
    if (value.byMonthDay !== undefined)
      addRuleIssue(ctx, 'Weekly recurrence does not take a month day.');
    return;
  }
  if (frequency === 'MONTHLY') {
    if (interval !== 1) addRuleIssue(ctx, 'Monthly recurrence uses an interval of 1.');
    if (value.byDay !== undefined) addRuleIssue(ctx, 'Monthly recurrence does not take weekdays.');
    return;
  }
  if (value.byDay !== undefined && value.byMonthDay !== undefined) {
    addRuleIssue(ctx, 'Custom recurrence takes weekdays or a month day, not both.');
    return;
  }
  if (value.byDay !== undefined) {
    if (interval < 2 || interval > 52) {
      addRuleIssue(ctx, 'Custom weekly recurrence uses an interval from 2 to 52.');
    }
    return;
  }
  if (value.byMonthDay !== undefined) {
    if (interval < 2 || interval > 12) {
      addRuleIssue(ctx, 'Custom monthly recurrence uses an interval from 2 to 12.');
    }
    return;
  }
  if (interval < 2 || interval > 99) {
    addRuleIssue(ctx, 'Custom daily recurrence uses an interval from 2 to 99.');
  }
}

function refineBounds(value: RuleFields, ctx: z.RefinementCtx): void {
  if (
    value.startDate !== undefined &&
    value.endDate !== undefined &&
    value.endDate !== null &&
    value.endDate < value.startDate
  ) {
    addRuleIssue(ctx, 'endDate must be on or after startDate.');
  }
  if (
    value.defaultStartMinute !== undefined &&
    value.defaultStartMinute !== null &&
    value.estimatedMinutes === null
  ) {
    addRuleIssue(ctx, 'Set an estimate before a start minute.');
  }
}

const ruleFields = {
  frequency: frequencySchema,
  interval: intervalSchema,
  byDay: byDaySchema.optional(),
  byMonthDay: byMonthDaySchema.optional(),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema.nullable().optional(),
  timezone: timezoneSchema.optional(),
  estimatedMinutes: estimatedMinutesSchema.nullable().optional(),
  defaultStartMinute: startMinuteSchema.nullable().optional(),
} as const;

export const createRecurringTaskRequestSchema = z
  .strictObject({
    title: taskTitleSchema,
    notes: taskNotesSchema.nullable().optional(),
    priority: taskPrioritySchema.optional(),
    ...ruleFields,
  })
  .superRefine((value, ctx) => {
    refineStructuredRule(value, ctx);
    refineBounds(value, ctx);
    if (
      (value.estimatedMinutes === undefined || value.estimatedMinutes === null) &&
      value.defaultStartMinute !== undefined &&
      value.defaultStartMinute !== null
    ) {
      addRuleIssue(ctx, 'Set an estimate before a start minute.');
    }
  });

const patchFields = {
  title: taskTitleSchema.optional(),
  notes: taskNotesSchema.nullable().optional(),
  priority: taskPrioritySchema.optional(),
  frequency: frequencySchema.optional(),
  interval: intervalSchema.optional(),
  byDay: byDaySchema.optional(),
  byMonthDay: byMonthDaySchema.optional(),
  startDate: calendarDateSchema.optional(),
  endDate: calendarDateSchema.nullable().optional(),
  timezone: timezoneSchema.optional(),
  estimatedMinutes: estimatedMinutesSchema.nullable().optional(),
  defaultStartMinute: startMinuteSchema.nullable().optional(),
} as const;

export const updateRecurringTaskRequestSchema = z
  .strictObject(patchFields)
  .superRefine((value, ctx) => {
    const keys = Object.keys(patchFields) as (keyof typeof patchFields)[];
    if (!keys.some((key) => value[key] !== undefined)) {
      addRuleIssue(ctx, 'Provide a field to update.');
      return;
    }
    const replacesRule =
      value.frequency !== undefined ||
      value.interval !== undefined ||
      value.byDay !== undefined ||
      value.byMonthDay !== undefined;
    if (replacesRule) refineStructuredRule(value, ctx);
    refineBounds(value, ctx);
  });

export const listRecurringTasksQuerySchema = z.strictObject({
  limit: limitSchema,
  cursor: z.string().min(1).max(512).optional(),
});

export const occurrenceRangeQuerySchema = z
  .strictObject({
    from: calendarDateSchema,
    to: calendarDateSchema,
  })
  .superRefine((value, ctx) => {
    if (value.from > value.to) {
      addRuleIssue(ctx, 'from must be on or before to.');
      return;
    }
    if (inclusiveDays(value.from, value.to) > 62) {
      addRuleIssue(ctx, 'The range must be at most 62 days.');
    }
  });

export const recurringTaskIdSchema = z.uuid('Enter a valid series id.');

export const occurrenceDateSchema = calendarDateSchema;

export const recurringTaskSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  priority: taskPrioritySchema,
  frequency: frequencySchema,
  interval: z.number().int().min(1).max(99),
  byDay: z.array(z.enum(RECURRENCE_WEEKDAYS)),
  byMonthDay: z.number().int().min(1).max(31).nullable(),
  recurrenceRule: z.string().min(1).max(500),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema.nullable(),
  timezone: z.string(),
  enabled: z.boolean(),
  estimatedMinutes: z.number().int().nullable(),
  defaultStartMinute: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<RecurringTask>;

export const recurringTaskListSchema = z.strictObject({
  items: z.array(recurringTaskSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<RecurringTaskList>;

export const taskOccurrenceSchema = z.strictObject({
  id: z.uuid(),
  recurringTaskId: z.uuid(),
  taskId: z.uuid().nullable(),
  occurrenceDate: calendarDateSchema,
  status: z.enum(OCCURRENCE_STATUSES),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<TaskOccurrence>;

export const taskOccurrenceListSchema = z.strictObject({
  items: z.array(taskOccurrenceSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<TaskOccurrenceList>;

export type CreateRecurringTaskRequest = z.infer<typeof createRecurringTaskRequestSchema>;
export type UpdateRecurringTaskRequest = z.infer<typeof updateRecurringTaskRequestSchema>;
export type ListRecurringTasksQuery = z.infer<typeof listRecurringTasksQuerySchema>;
export type OccurrenceRangeQuery = z.infer<typeof occurrenceRangeQuerySchema>;
