import type { TaskPriority, TaskStatus } from '@planit/types';

export interface TaskListRequest {
  status: readonly TaskStatus[];
  priority?: TaskPriority;
  due?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  sort?: string;
  cursor?: string | null;
}

/** Builds the owner task list URL. Repeated status keys stay repeated. Sort is omitted when unset. */
export function taskListPath(request: TaskListRequest): `/${string}` {
  const params = new URLSearchParams();
  for (const status of request.status) params.append('status', status);
  if (request.priority !== undefined) params.set('priority', request.priority);
  if (request.due) params.set('due', request.due);
  if (request.scheduledFrom) params.set('scheduledFrom', request.scheduledFrom);
  if (request.scheduledTo) params.set('scheduledTo', request.scheduledTo);
  if (request.sort) params.set('sort', request.sort);
  if (request.cursor) params.set('cursor', request.cursor);
  const query = params.toString();
  return query.length === 0 ? '/v1/tasks' : `/v1/tasks?${query}`;
}
