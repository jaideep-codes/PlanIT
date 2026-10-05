'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  createTaskRequestSchema,
  currentUserSchema,
  TASK_PRIORITIES,
  taskListSchema,
  taskSchema,
} from '@planit/shared';
import type { DefaultTaskSort, Task, TaskPriority, TaskStatus } from '@planit/types';
import { Badge } from '@planit/ui/components/badge';
import { Button } from '@planit/ui/components/button';
import { Input } from '@planit/ui/components/input';
import { Label } from '@planit/ui/components/label';
import { Skeleton } from '@planit/ui/components/skeleton';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';

import { TaskEditor } from '@/components/tasks/task-editor';
import { taskControlClassName } from '@/components/tasks/task-fields';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api/api-client';
import { currentUserQueryKey } from '@/lib/api/current-user';
import { manualPositionChoice, type ManualNeighbors } from '@/lib/tasks/manual-position';
import { formatSchedule, wallTimeToUtc } from '@/lib/tasks/schedule-time';
import { taskListPath, type TaskListRequest } from '@/lib/tasks/task-list-query';

const TASKS_QUERY_KEY = ['tasks', 'list'] as const;

const STATUS_ORDER: readonly TaskStatus[] = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

const PRIORITY_VARIANT = {
  HIGH: 'destructive',
  MEDIUM: 'warning',
  LOW: 'secondary',
} as const;

const SORT_OPTIONS: readonly { value: DefaultTaskSort; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'priority', label: 'Priority' },
  { value: 'dueDate', label: 'Due date' },
  { value: 'scheduledStart', label: 'Scheduled start' },
  { value: 'createdAt', label: 'Created' },
];

interface TaskFilters {
  status: TaskStatus[];
  priority: '' | TaskPriority;
  due: string;
  scheduledFrom: string;
  scheduledTo: string;
}

const DEFAULT_FILTERS: TaskFilters = {
  status: ['TODO', 'IN_PROGRESS'],
  priority: '',
  due: '',
  scheduledFrom: '',
  scheduledTo: '',
};

function apiMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function QuickAdd({ onAdded }: { onAdded: () => Promise<void> }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createTaskRequestSchema),
    defaultValues: { title: '' },
  });

  return (
    <form
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      noValidate
      onSubmit={handleSubmit(async (values) => {
        setFormError(null);
        try {
          await apiPost('/v1/tasks', { title: values.title }, taskSchema);
          reset({ title: '' });
          await onAdded();
        } catch (error) {
          setFormError(apiMessage(error, 'Could not add this task.'));
        }
      })}
    >
      <div className="grid gap-2">
        <Label htmlFor="task-title">Title</Label>
        <Input
          id="task-title"
          autoComplete="off"
          required
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? 'task-title-error' : undefined}
          {...register('title')}
        />
        {errors.title?.message ? (
          <p id="task-title-error" className="text-sm text-destructive">
            {errors.title.message}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
        {isSubmitting ? 'Adding…' : 'Add task'}
      </Button>
      {formError ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {formError}
        </p>
      ) : null}
    </form>
  );
}

export function TaskList() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [descending, setDescending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sortError, setSortError] = useState<string | null>(null);

  const me = useQuery({
    queryKey: currentUserQueryKey,
    queryFn: ({ signal }) => apiGet('/v1/users/me', currentUserSchema, { signal }),
  });

  const timezone = me.data?.timezone;
  const sortField = me.data?.defaultTaskSort;
  const sort = sortField === undefined ? undefined : `${descending ? '-' : ''}${sortField}`;
  const forwardManual = sortField === 'manual' && !descending;

  const scheduleFilter = useMemo(() => {
    if (!timezone) return { from: undefined, to: undefined, error: null as string | null };
    try {
      return {
        from: filters.scheduledFrom ? wallTimeToUtc(filters.scheduledFrom, timezone) : undefined,
        to: filters.scheduledTo ? wallTimeToUtc(filters.scheduledTo, timezone) : undefined,
        error: null as string | null,
      };
    } catch (error) {
      return {
        from: undefined,
        to: undefined,
        error: error instanceof Error ? error.message : 'Enter a schedule time.',
      };
    }
  }, [filters.scheduledFrom, filters.scheduledTo, timezone]);

  const listRequest = useMemo<TaskListRequest>(
    () => ({
      status: filters.status,
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.due ? { due: filters.due } : {}),
      ...(scheduleFilter.from ? { scheduledFrom: scheduleFilter.from } : {}),
      ...(scheduleFilter.to ? { scheduledTo: scheduleFilter.to } : {}),
      ...(sort ? { sort } : {}),
    }),
    [filters.due, filters.priority, filters.status, scheduleFilter.from, scheduleFilter.to, sort],
  );

  const tasks = useInfiniteQuery({
    queryKey: [...TASKS_QUERY_KEY, listRequest],
    enabled: scheduleFilter.error === null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiGet(taskListPath({ ...listRequest, cursor: pageParam }), taskListSchema, { signal }),
    getNextPageParam: (page) => page.nextCursor,
  });

  const saveSort = useMutation({
    mutationFn: (defaultTaskSort: DefaultTaskSort) =>
      apiPatch('/v1/users/me/task-sort', { defaultTaskSort }, currentUserSchema),
    onSuccess: (saved) => {
      queryClient.setQueryData(currentUserQueryKey, saved);
      setSortError(null);
    },
    onError: (error) => {
      setSortError(apiMessage(error, 'Could not save the sort.'));
    },
  });

  async function refreshFromFirstPage(): Promise<void> {
    await queryClient.resetQueries({ queryKey: TASKS_QUERY_KEY });
  }

  async function runRow(id: string, action: () => Promise<unknown>): Promise<void> {
    setPendingId(id);
    setRowError(null);
    try {
      await action();
      setEditingId((current) => (current === id ? null : current));
      setConfirmingId((current) => (current === id ? null : current));
      await refreshFromFirstPage();
    } catch (error) {
      setRowError({ id, message: apiMessage(error, 'Could not update this task.') });
    } finally {
      setPendingId(null);
    }
  }

  function toggleStatus(status: TaskStatus, checked: boolean): void {
    setFilters((current) => {
      const next = new Set(current.status);
      if (checked) next.add(status);
      else next.delete(status);
      return { ...current, status: STATUS_ORDER.filter((item) => next.has(item)) };
    });
  }

  const items = tasks.data?.pages.flatMap((page) => page.items) ?? [];
  const ids = items.map((item) => item.id);
  const defaultOpen =
    filters.status.length === 2 &&
    filters.status.includes('TODO') &&
    filters.status.includes('IN_PROGRESS') &&
    filters.priority === '' &&
    filters.due === '' &&
    filters.scheduledFrom === '' &&
    filters.scheduledTo === '';

  return (
    <section className="grid gap-4" aria-labelledby="tasks-heading">
      <h2 id="tasks-heading" className="text-lg font-semibold tracking-tight">
        Tasks
      </h2>
      <QuickAdd onAdded={refreshFromFirstPage} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="task-sort">Sort</Label>
          <select
            id="task-sort"
            className={taskControlClassName}
            value={sortField ?? ''}
            disabled={sortField === undefined || saveSort.isPending}
            onChange={(event) => {
              const next = event.target.value;
              if (SORT_OPTIONS.some((option) => option.value === next)) {
                saveSort.mutate(next as DefaultTaskSort);
              }
            }}
          >
            {sortField === undefined ? <option value="">Loading sort…</option> : null}
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="task-sort-direction">Direction</Label>
          <select
            id="task-sort-direction"
            className={taskControlClassName}
            value={descending ? 'desc' : 'asc'}
            disabled={sortField === undefined}
            onChange={(event) => {
              setDescending(event.target.value === 'desc');
            }}
          >
            <option value="asc">Forward</option>
            <option value="desc">Reverse</option>
          </select>
        </div>
      </div>
      {me.isError ? (
        <div className="grid gap-3">
          <p role="alert" className="text-sm text-destructive">
            {apiMessage(me.error, 'Could not load your sort preference.')}
          </p>
          <Button type="button" variant="outline" onClick={() => void me.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {sortError ? (
        <p role="alert" className="text-sm text-destructive">
          {sortError}
        </p>
      ) : null}
      <fieldset className="grid gap-4">
        <legend className="text-sm font-medium">Filters</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {STATUS_ORDER.map((status) => (
            <label key={status} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={filters.status.includes(status)}
                onChange={(event) => {
                  toggleStatus(status, event.target.checked);
                }}
              />
              {STATUS_LABEL[status]}
            </label>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="task-filter-priority">Priority</Label>
            <select
              id="task-filter-priority"
              className={taskControlClassName}
              value={filters.priority}
              onChange={(event) => {
                const value = event.target.value;
                setFilters((current) => ({
                  ...current,
                  priority: TASK_PRIORITIES.find((item) => item === value) ?? '',
                }));
              }}
            >
              <option value="">Any priority</option>
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABEL[priority]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-filter-due">Due date</Label>
            <Input
              id="task-filter-due"
              type="date"
              value={filters.due}
              onChange={(event) => {
                setFilters((current) => ({ ...current, due: event.target.value }));
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-filter-from">Scheduled from</Label>
            <input
              id="task-filter-from"
              type="datetime-local"
              className={taskControlClassName}
              value={filters.scheduledFrom}
              disabled={timezone === undefined}
              onChange={(event) => {
                setFilters((current) => ({ ...current, scheduledFrom: event.target.value }));
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-filter-to">Scheduled to</Label>
            <input
              id="task-filter-to"
              type="datetime-local"
              className={taskControlClassName}
              value={filters.scheduledTo}
              disabled={timezone === undefined}
              onChange={(event) => {
                setFilters((current) => ({ ...current, scheduledTo: event.target.value }));
              }}
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Schedule filters use your account timezone{timezone ? ` (${timezone})` : ''}.
        </p>
        {scheduleFilter.error ? (
          <p role="alert" className="text-sm text-destructive">
            {scheduleFilter.error}
          </p>
        ) : null}
      </fieldset>
      {tasks.isPending ? (
        <div className="grid gap-3" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading tasks</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : tasks.isError && !tasks.data ? (
        <div className="grid gap-3">
          <p role="alert" className="text-sm text-destructive">
            {apiMessage(tasks.error, 'Could not load tasks.')}
          </p>
          <Button type="button" variant="outline" onClick={() => void tasks.refetch()}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
          {defaultOpen ? 'No open tasks yet. Add a task above.' : 'No tasks match these filters.'}
        </p>
      ) : (
        <ul aria-label="Tasks" className="grid gap-3">
          {items.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              timezone={timezone}
              pending={pendingId === task.id}
              editing={editingId === task.id}
              confirming={confirmingId === task.id}
              error={rowError?.id === task.id ? rowError.message : null}
              showMoves={forwardManual}
              moveUp={forwardManual ? manualPositionChoice(ids, index, 'up') : null}
              moveDown={forwardManual ? manualPositionChoice(ids, index, 'down') : null}
              onEdit={() => {
                setRowError(null);
                setConfirmingId(null);
                setEditingId(task.id);
              }}
              onCancelEdit={() => {
                setEditingId(null);
              }}
              onAskDelete={() => {
                setEditingId(null);
                setConfirmingId(task.id);
              }}
              onCancelDelete={() => {
                setConfirmingId(null);
              }}
              onComplete={() =>
                void runRow(task.id, () => apiPost(`/v1/tasks/${task.id}/complete`, {}, taskSchema))
              }
              onReopen={() =>
                void runRow(task.id, () => apiPost(`/v1/tasks/${task.id}/reopen`, {}, taskSchema))
              }
              onDelete={() =>
                void runRow(task.id, () => apiDelete(`/v1/tasks/${task.id}`, taskSchema))
              }
              onMove={(neighbors) =>
                void runRow(task.id, () =>
                  apiPatch(`/v1/tasks/${task.id}/position`, neighbors, taskSchema),
                )
              }
              onSaved={async () => {
                setEditingId(null);
                await refreshFromFirstPage();
              }}
            />
          ))}
        </ul>
      )}
      {tasks.isFetchNextPageError ? (
        <p role="alert" className="text-sm text-destructive">
          {apiMessage(tasks.error, 'Could not load more tasks.')}
        </p>
      ) : null}
      {tasks.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => void tasks.fetchNextPage()}
          disabled={tasks.isFetchingNextPage}
          aria-busy={tasks.isFetchingNextPage}
        >
          {tasks.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </section>
  );
}

function TaskRow({
  task,
  timezone,
  pending,
  editing,
  confirming,
  error,
  showMoves,
  moveUp,
  moveDown,
  onEdit,
  onCancelEdit,
  onAskDelete,
  onCancelDelete,
  onComplete,
  onReopen,
  onDelete,
  onMove,
  onSaved,
}: {
  task: Task;
  timezone: string | undefined;
  pending: boolean;
  editing: boolean;
  confirming: boolean;
  error: string | null;
  showMoves: boolean;
  moveUp: ManualNeighbors | null;
  moveDown: ManualNeighbors | null;
  onEdit: () => void;
  onCancelEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onMove: (neighbors: ManualNeighbors) => void;
  onSaved: () => Promise<void>;
}) {
  const schedule =
    task.scheduledStart && task.scheduledEnd && timezone
      ? formatSchedule(task.scheduledStart, task.scheduledEnd, timezone)
      : null;

  return (
    <li className="grid gap-3 rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-2">
          <p className="font-medium break-words">{task.title}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={PRIORITY_VARIANT[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
            <span>{STATUS_LABEL[task.status]}</span>
            {task.dueDate ? <span>Due {task.dueDate}</span> : null}
            {schedule ? <span>Scheduled {schedule}</span> : null}
          </div>
          {task.notes ? (
            <p className="text-sm break-words whitespace-pre-wrap">{task.notes}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {showMoves ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || moveUp === null}
                onClick={() => {
                  if (moveUp) onMove(moveUp);
                }}
              >
                Move up
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || moveDown === null}
                onClick={() => {
                  if (moveDown) onMove(moveDown);
                }}
              >
                Move down
              </Button>
            </>
          ) : null}
          {task.status === 'COMPLETED' ? (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onReopen}>
              Reopen
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={pending} onClick={onComplete}>
              Complete
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || timezone === undefined}
            onClick={editing ? onCancelEdit : onEdit}
          >
            {editing ? 'Close' : 'Edit'}
          </Button>
          {confirming ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={onDelete}
              >
                Confirm delete
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={onCancelDelete}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={onAskDelete}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {editing && timezone ? (
        <TaskEditor task={task} timezone={timezone} onSaved={onSaved} onCancel={onCancelEdit} />
      ) : null}
    </li>
  );
}
