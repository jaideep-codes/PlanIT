import type { Task, TaskList, TaskPriority, TaskStatus } from '@planit/types';
import { z } from 'zod';

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const satisfies readonly TaskPriority[];

export const TASK_STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const satisfies readonly TaskStatus[];

/** Status values a field edit may set. Completion goes through the complete route. */
export const TASK_PATCH_STATUSES = ['TODO', 'IN_PROGRESS', 'CANCELLED'] as const;

export const TASK_SORT_FIELDS = [
  'manual',
  'priority',
  'dueDate',
  'scheduledStart',
  'createdAt',
] as const;

export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

const TITLE_MAX = 200;
const NOTES_MAX = 10_000;
const ESTIMATE_MAX = 10_080;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export const taskTitleSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const length = codePointLength(value);
    if (length < 1) {
      ctx.addIssue({ code: 'custom', message: 'Enter a title.' });
    } else if (length > TITLE_MAX) {
      ctx.addIssue({ code: 'custom', message: 'Title must be at most 200 characters.' });
    }
  });

/** Trimmed. A blank value becomes null so the column stays null instead of empty. */
export const taskNotesSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (codePointLength(value) > NOTES_MAX) {
      ctx.addIssue({ code: 'custom', message: 'Notes must be at most 10000 characters.' });
    }
  })
  .transform((value) => (value.length === 0 ? null : value));

export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

export const calendarDateSchema = z.iso.date('Enter a calendar date as YYYY-MM-DD.');

/** An instant. `Z` and numeric offsets are both accepted; the API stores UTC. */
const instantSchema = z.iso.datetime({ offset: true, error: 'Enter an ISO 8601 timestamp.' });

export const estimatedMinutesSchema = z
  .number()
  .int('Enter a whole number of minutes.')
  .min(1, 'Estimate must be at least 1 minute.')
  .max(ESTIMATE_MAX, 'Estimate must be at most 10080 minutes.');

type ScheduleFields = {
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
};

function refineSchedule(value: ScheduleFields, ctx: z.RefinementCtx): void {
  const startSet = value.scheduledStart !== undefined;
  const endSet = value.scheduledEnd !== undefined;
  if (startSet !== endSet) {
    ctx.addIssue({
      code: 'custom',
      message: 'Send scheduledStart and scheduledEnd together.',
    });
    return;
  }
  if (!startSet) return;
  const start = value.scheduledStart ?? null;
  const end = value.scheduledEnd ?? null;
  if ((start === null) !== (end === null)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Set both schedule times, or clear both.',
    });
    return;
  }
  if (start !== null && end !== null && Date.parse(end) <= Date.parse(start)) {
    ctx.addIssue({
      code: 'custom',
      message: 'scheduledEnd must be after scheduledStart.',
    });
  }
}

export const createTaskRequestSchema = z
  .strictObject({
    title: taskTitleSchema,
    notes: taskNotesSchema.nullable().optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: calendarDateSchema.nullable().optional(),
    scheduledStart: instantSchema.nullable().optional(),
    scheduledEnd: instantSchema.nullable().optional(),
    estimatedMinutes: estimatedMinutesSchema.nullable().optional(),
  })
  .superRefine(refineSchedule);

const updateTaskFields = {
  title: taskTitleSchema.optional(),
  notes: taskNotesSchema.nullable().optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: calendarDateSchema.nullable().optional(),
  scheduledStart: instantSchema.nullable().optional(),
  scheduledEnd: instantSchema.nullable().optional(),
  estimatedMinutes: estimatedMinutesSchema.nullable().optional(),
  status: z.enum(TASK_PATCH_STATUSES).optional(),
} as const;

export const updateTaskRequestSchema = z
  .strictObject(updateTaskFields)
  .superRefine((value, ctx) => {
    refineSchedule(value, ctx);
    const hasField = (Object.keys(updateTaskFields) as (keyof typeof updateTaskFields)[]).some(
      (key) => value[key] !== undefined,
    );
    if (!hasField) {
      ctx.addIssue({ code: 'custom', message: 'Provide a field to update.' });
    }
  });

export const repositionTaskRequestSchema = z
  .strictObject({
    beforeId: z.uuid('Enter a valid task id.').optional(),
    afterId: z.uuid('Enter a valid task id.').optional(),
  })
  .superRefine((value, ctx) => {
    if (value.beforeId === undefined && value.afterId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Provide beforeId, afterId, or both.' });
    }
    if (value.beforeId !== undefined && value.beforeId === value.afterId) {
      ctx.addIssue({
        code: 'custom',
        message: 'beforeId and afterId must be different tasks.',
      });
    }
  });

export const taskIdSchema = z.uuid('Enter a valid task id.');

function oneOrMore<const T extends readonly [string, ...string[]]>(values: T, max: number) {
  const item = z.enum(values);
  return z.union([item, z.array(item).min(1).max(max)]).transform((value) => {
    const list = Array.isArray(value) ? value : [value];
    return [...new Set(list)];
  });
}

const sortSchema = z
  .string()
  .regex(
    /^-?(?:manual|priority|dueDate|scheduledStart|createdAt)$/,
    'Sort by manual, priority, dueDate, scheduledStart, or createdAt.',
  );

export const listTasksQuerySchema = z
  .strictObject({
    limit: z
      .string()
      .regex(/^[1-9]\d*$/, 'limit must be an integer from 1 to 100.')
      .transform(Number)
      .pipe(z.number().int().min(1).max(100, 'limit must be an integer from 1 to 100.'))
      .optional()
      .default(20),
    cursor: z.string().min(1).max(512).optional(),
    status: oneOrMore(TASK_STATUSES, TASK_STATUSES.length).optional(),
    priority: oneOrMore(TASK_PRIORITIES, TASK_PRIORITIES.length).optional(),
    due: calendarDateSchema.optional(),
    scheduledFrom: instantSchema.optional(),
    scheduledTo: instantSchema.optional(),
    sort: sortSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.scheduledFrom !== undefined &&
      value.scheduledTo !== undefined &&
      Date.parse(value.scheduledFrom) > Date.parse(value.scheduledTo)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'scheduledFrom must be before or equal to scheduledTo.',
      });
    }
  });

export const taskSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  priority: taskPrioritySchema,
  status: z.enum(TASK_STATUSES),
  dueDate: calendarDateSchema.nullable(),
  scheduledStart: z.iso.datetime().nullable(),
  scheduledEnd: z.iso.datetime().nullable(),
  estimatedMinutes: z.number().int().nullable(),
  completedAt: z.iso.datetime().nullable(),
  sortOrder: z.string().min(1).max(64),
  recurringTaskId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<Task>;

export const taskListSchema = z.strictObject({
  items: z.array(taskSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<TaskList>;

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;
export type RepositionTaskRequest = z.infer<typeof repositionTaskRequestSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
