/** Stored and returned in this order. Forward `priority` sort is HIGH, then MEDIUM, then LOW. */
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

/** `COMPLETED` is set only by the complete route. PATCH accepts the other three. */
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

/**
 * Owner-only task projection. `userId` is not part of this contract.
 * Timestamps are ISO 8601 UTC. `dueDate` is a `YYYY-MM-DD` calendar date or null.
 */
export interface Task {
  id: string;
  title: string;
  notes: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  estimatedMinutes: number | null;
  completedAt: string | null;
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
}

/** Cursor page of the caller's tasks. `nextCursor` is null on the last page. */
export interface TaskList {
  items: Task[];
  nextCursor: string | null;
}
