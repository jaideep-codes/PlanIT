import type { TaskSortField } from '@planit/shared';
import type { Task } from '@planit/types';
import { z } from 'zod';

import {
  sortToken,
  type ResolvedTaskSort,
  type TaskListFilters,
  type TaskPageCursor,
} from './task-query.js';

export class BadTaskCursorError extends Error {
  constructor() {
    super('The cursor is invalid.');
    this.name = 'BadTaskCursorError';
  }
}

const cursorBodySchema = z.strictObject({
  q: z.string().min(1).max(400),
  id: z.uuid(),
  key: z.string().min(1).max(64).nullable(),
});

/** Stable across query-parameter order. The cursor is only valid for this exact page query. */
export function taskQueryFingerprint(filters: TaskListFilters, sort: ResolvedTaskSort): string {
  return JSON.stringify({
    sort: sortToken(sort),
    status: filters.status ?? null,
    priority: filters.priority ?? null,
    due: filters.due ?? null,
    scheduledFrom: filters.scheduledFrom ?? null,
    scheduledTo: filters.scheduledTo ?? null,
  });
}

function cursorKey(task: Task, sort: ResolvedTaskSort): string | null {
  switch (sort.field) {
    case 'manual':
      return task.sortOrder;
    case 'priority':
      return task.priority;
    case 'dueDate':
      return task.dueDate;
    case 'scheduledStart':
      return task.scheduledStart;
    case 'createdAt':
      return task.createdAt;
  }
}

function keyFits(key: string | null, field: TaskSortField): boolean {
  switch (field) {
    case 'dueDate':
      return key === null || /^\d{4}-\d{2}-\d{2}$/.test(key);
    case 'scheduledStart':
      return key === null || !Number.isNaN(Date.parse(key));
    case 'priority':
      return key === 'LOW' || key === 'MEDIUM' || key === 'HIGH';
    case 'manual':
      return key !== null && key.length >= 1;
    case 'createdAt':
      return key !== null && !Number.isNaN(Date.parse(key));
  }
}

export function encodeTaskCursor(
  task: Task,
  filters: TaskListFilters,
  sort: ResolvedTaskSort,
): string {
  const body = {
    q: taskQueryFingerprint(filters, sort),
    id: task.id,
    key: cursorKey(task, sort),
  };
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
}

export function decodeTaskCursor(
  cursor: string,
  filters: TaskListFilters,
  sort: ResolvedTaskSort,
): TaskPageCursor {
  let parsed: unknown;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw new BadTaskCursorError();
  }
  const result = cursorBodySchema.safeParse(parsed);
  if (!result.success) throw new BadTaskCursorError();
  if (result.data.q !== taskQueryFingerprint(filters, sort)) throw new BadTaskCursorError();
  if (!keyFits(result.data.key, sort.field)) throw new BadTaskCursorError();
  return { id: result.data.id, key: result.data.key };
}
