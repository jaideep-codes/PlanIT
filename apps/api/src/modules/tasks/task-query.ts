import type { TaskSortField } from '@planit/shared';
import type { TaskPriority, TaskStatus } from '@planit/types';

import type { Prisma } from '../../generated/prisma/client.js';
import { calendarDateToUtc } from './task-dates.js';

export interface ResolvedTaskSort {
  field: TaskSortField;
  /** True when the client sent a leading `-`, which reverses the forward order. */
  descending: boolean;
}

export interface TaskListFilters {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  due?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
}

export interface TaskPageCursor {
  id: string;
  key: string | null;
}

export type StoredTaskSort = 'MANUAL' | 'PRIORITY' | 'DUE_DATE' | 'SCHEDULED_START' | 'CREATED_AT';

const PREFERENCE_FIELD: Record<StoredTaskSort, TaskSortField> = {
  MANUAL: 'manual',
  PRIORITY: 'priority',
  DUE_DATE: 'dueDate',
  SCHEDULED_START: 'scheduledStart',
  CREATED_AT: 'createdAt',
};

/** Forward order. Priority lists HIGH first. Dates put nulls last. Manual order is ascending. */
export function preferenceToSort(preference: StoredTaskSort): ResolvedTaskSort {
  return { field: PREFERENCE_FIELD[preference], descending: false };
}

/** Inverse of {@link preferenceToSort}. Uses the same table; direction is never stored. */
export function preferenceFromSortField(field: TaskSortField): StoredTaskSort {
  const stored = (Object.keys(PREFERENCE_FIELD) as StoredTaskSort[]).find(
    (key) => PREFERENCE_FIELD[key] === field,
  );
  if (stored === undefined) throw new Error('Unknown task sort field.');
  return stored;
}

export function parseSort(value: string): ResolvedTaskSort {
  const descending = value.startsWith('-');
  const field = (descending ? value.slice(1) : value) as TaskSortField;
  return { field, descending };
}

export function sortToken(sort: ResolvedTaskSort): string {
  return sort.descending ? `-${sort.field}` : sort.field;
}

export function compareManual(
  left: { sortOrder: string; id: string },
  right: { sortOrder: string; id: string },
): number {
  if (left.sortOrder < right.sortOrder) return -1;
  if (left.sortOrder > right.sortOrder) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

const PRIORITY_FORWARD: readonly TaskPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

function laterPriorities(priority: TaskPriority, descending: boolean): TaskPriority[] {
  const order = descending ? [...PRIORITY_FORWARD].reverse() : PRIORITY_FORWARD;
  return order.slice(order.indexOf(priority) + 1);
}

function idCompare(id: string, descending: boolean): { lt: string } | { gt: string } {
  return descending ? { lt: id } : { gt: id };
}

function requiredKey(key: string | null): string {
  if (!key) throw new Error('Invalid task cursor key.');
  return key;
}

function priorityKey(key: string | null): TaskPriority {
  if (key === 'LOW' || key === 'MEDIUM' || key === 'HIGH') return key;
  throw new Error('Invalid task cursor key.');
}

function priorityCursor(
  priority: TaskPriority,
  id: string,
  descending: boolean,
): Prisma.TaskWhereInput {
  const same: Prisma.TaskWhereInput = { priority, id: idCompare(id, descending) };
  const later = laterPriorities(priority, descending);
  if (later.length === 0) return same;
  return { OR: [same, { priority: { in: later } }] };
}

function dueCursor(key: string | null, id: string, descending: boolean): Prisma.TaskWhereInput {
  const sameId = idCompare(id, descending);
  if (!descending) {
    if (key === null) return { dueDate: null, id: sameId };
    const dueDate = calendarDateToUtc(key);
    return {
      OR: [{ dueDate: { gt: dueDate } }, { dueDate, id: sameId }, { dueDate: null }],
    };
  }
  if (key === null) {
    return { OR: [{ dueDate: null, id: sameId }, { dueDate: { not: null } }] };
  }
  const dueDate = calendarDateToUtc(key);
  return { OR: [{ dueDate: { lt: dueDate } }, { dueDate, id: sameId }] };
}

function scheduledCursor(
  key: string | null,
  id: string,
  descending: boolean,
): Prisma.TaskWhereInput {
  const sameId = idCompare(id, descending);
  if (!descending) {
    if (key === null) return { scheduledStart: null, id: sameId };
    const scheduledStart = new Date(key);
    return {
      OR: [
        { scheduledStart: { gt: scheduledStart } },
        { scheduledStart, id: sameId },
        { scheduledStart: null },
      ],
    };
  }
  if (key === null) {
    return { OR: [{ scheduledStart: null, id: sameId }, { scheduledStart: { not: null } }] };
  }
  const scheduledStart = new Date(key);
  return {
    OR: [{ scheduledStart: { lt: scheduledStart } }, { scheduledStart, id: sameId }],
  };
}

function createdCursor(key: string, id: string, descending: boolean): Prisma.TaskWhereInput {
  const value = new Date(key);
  const sameId = idCompare(id, descending);
  if (descending) {
    return { OR: [{ createdAt: { lt: value } }, { createdAt: value, id: sameId }] };
  }
  return { OR: [{ createdAt: { gt: value } }, { createdAt: value, id: sameId }] };
}

function manualCursor(key: string, id: string, descending: boolean): Prisma.TaskWhereInput {
  const sameId = idCompare(id, descending);
  if (descending) {
    return { OR: [{ sortOrder: { lt: key } }, { sortOrder: key, id: sameId }] };
  }
  return { OR: [{ sortOrder: { gt: key } }, { sortOrder: key, id: sameId }] };
}

function cursorWhere(sort: ResolvedTaskSort, cursor: TaskPageCursor): Prisma.TaskWhereInput {
  switch (sort.field) {
    case 'manual':
      return manualCursor(requiredKey(cursor.key), cursor.id, sort.descending);
    case 'priority':
      return priorityCursor(priorityKey(cursor.key), cursor.id, sort.descending);
    case 'dueDate':
      return dueCursor(cursor.key, cursor.id, sort.descending);
    case 'scheduledStart':
      return scheduledCursor(cursor.key, cursor.id, sort.descending);
    case 'createdAt':
      return createdCursor(requiredKey(cursor.key), cursor.id, sort.descending);
  }
}

function filterWhere(filters: TaskListFilters): Prisma.TaskWhereInput {
  const scheduled =
    filters.scheduledFrom !== undefined || filters.scheduledTo !== undefined
      ? {
          scheduledStart: {
            ...(filters.scheduledFrom !== undefined
              ? { gte: new Date(filters.scheduledFrom) }
              : {}),
            ...(filters.scheduledTo !== undefined ? { lte: new Date(filters.scheduledTo) } : {}),
          },
        }
      : {};
  return {
    ...(filters.status !== undefined ? { status: { in: filters.status } } : {}),
    ...(filters.priority !== undefined ? { priority: { in: filters.priority } } : {}),
    ...(filters.due !== undefined ? { dueDate: calendarDateToUtc(filters.due) } : {}),
    ...scheduled,
  };
}

/** One page query. `userId` is always in the WHERE clause. */
export function taskPageWhere(
  userId: string,
  filters: TaskListFilters,
  sort: ResolvedTaskSort,
  cursor: TaskPageCursor | null,
): Prisma.TaskWhereInput {
  return {
    AND: [{ userId }, filterWhere(filters), ...(cursor ? [cursorWhere(sort, cursor)] : [])],
  };
}

export function taskPageOrderBy(sort: ResolvedTaskSort): Prisma.TaskOrderByWithRelationInput[] {
  const id: Prisma.SortOrder = sort.descending ? 'desc' : 'asc';
  const direction: Prisma.SortOrder = sort.descending ? 'desc' : 'asc';
  switch (sort.field) {
    case 'manual':
      return [{ sortOrder: direction }, { id }];
    case 'priority':
      return [{ priority: sort.descending ? 'asc' : 'desc' }, { id }];
    case 'dueDate':
      return [{ dueDate: { sort: direction, nulls: sort.descending ? 'first' : 'last' } }, { id }];
    case 'scheduledStart':
      return [
        { scheduledStart: { sort: direction, nulls: sort.descending ? 'first' : 'last' } },
        { id },
      ];
    case 'createdAt':
      return [{ createdAt: direction }, { id }];
  }
}

function afterAnchor(anchor: { sortOrder: string; id: string }): Prisma.TaskWhereInput {
  return {
    OR: [
      { sortOrder: { gt: anchor.sortOrder } },
      { sortOrder: anchor.sortOrder, id: { gt: anchor.id } },
    ],
  };
}

function beforeAnchor(anchor: { sortOrder: string; id: string }): Prisma.TaskWhereInput {
  return {
    OR: [
      { sortOrder: { lt: anchor.sortOrder } },
      { sortOrder: anchor.sortOrder, id: { lt: anchor.id } },
    ],
  };
}

export function manualNextWhere(
  userId: string,
  anchor: { sortOrder: string; id: string },
  excludeId: string,
): Prisma.TaskWhereInput {
  return { userId, id: { not: excludeId }, ...afterAnchor(anchor) };
}

export function manualPreviousWhere(
  userId: string,
  anchor: { sortOrder: string; id: string },
  excludeId: string,
): Prisma.TaskWhereInput {
  return { userId, id: { not: excludeId }, ...beforeAnchor(anchor) };
}

export function manualBetweenWhere(
  userId: string,
  before: { sortOrder: string; id: string },
  after: { sortOrder: string; id: string },
  excludeId: string,
): Prisma.TaskWhereInput {
  return {
    userId,
    id: { not: excludeId },
    AND: [afterAnchor(before), beforeAnchor(after)],
  };
}
