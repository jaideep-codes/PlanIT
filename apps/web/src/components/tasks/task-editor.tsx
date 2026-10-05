'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  TASK_PATCH_STATUSES,
  TASK_PRIORITIES,
  taskSchema,
  updateTaskRequestSchema,
} from '@planit/shared';
import type { Task, TaskStatus } from '@planit/types';
import { Button } from '@planit/ui/components/button';
import { Input } from '@planit/ui/components/input';
import { Label } from '@planit/ui/components/label';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, type FieldErrors } from 'react-hook-form';

import { taskControlClassName, taskTextareaClassName } from '@/components/tasks/task-fields';
import { ApiError, apiPatch } from '@/lib/api/api-client';
import { utcToWallTime, wallTimeToUtc } from '@/lib/tasks/schedule-time';

const STATUS_LABEL: Record<(typeof TASK_PATCH_STATUSES)[number], string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  CANCELLED: 'Cancelled',
};

const PRIORITY_LABEL: Record<(typeof TASK_PRIORITIES)[number], string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

function formMessages(errors: FieldErrors): string[] {
  const messages: string[] = [];
  const take = (value: unknown): void => {
    if (!value || typeof value !== 'object' || !('message' in value)) return;
    if (typeof value.message === 'string' && value.message.length > 0) messages.push(value.message);
  };
  const record = errors as Record<string, unknown>;
  take(record.root);
  take(record['']);
  for (const key of [
    'title',
    'notes',
    'priority',
    'dueDate',
    'scheduledStart',
    'scheduledEnd',
    'estimatedMinutes',
    'status',
  ]) {
    take(record[key]);
  }
  return [...new Set(messages)];
}

function editableStatus(status: TaskStatus): (typeof TASK_PATCH_STATUSES)[number] | undefined {
  if (status === 'TODO' || status === 'IN_PROGRESS' || status === 'CANCELLED') return status;
  return undefined;
}

export function TaskEditor({
  task,
  timezone,
  onSaved,
  onCancel,
}: {
  task: Task;
  timezone: string;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const status = editableStatus(task.status);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(updateTaskRequestSchema),
    defaultValues: {
      title: task.title,
      notes: task.notes ?? '',
      priority: task.priority,
      dueDate: task.dueDate,
      scheduledStart: task.scheduledStart,
      scheduledEnd: task.scheduledEnd,
      estimatedMinutes: task.estimatedMinutes,
      ...(status ? { status } : {}),
    },
  });

  const save = useMutation({
    mutationFn: (values: {
      title?: string;
      notes?: string | null;
      priority?: Task['priority'];
      dueDate?: string | null;
      scheduledStart?: string | null;
      scheduledEnd?: string | null;
      estimatedMinutes?: number | null;
      status?: (typeof TASK_PATCH_STATUSES)[number];
    }) => apiPatch(`/v1/tasks/${task.id}`, values, taskSchema),
  });

  const idPrefix = `task-${task.id}`;
  const messages = formMessages(errors);

  return (
    <form
      className="grid gap-4 border-t pt-4"
      noValidate
      onSubmit={handleSubmit(async (values) => {
        setSaveError(null);
        try {
          await save.mutateAsync(values);
          await onSaved();
        } catch (error) {
          setSaveError(error instanceof ApiError ? error.message : 'Could not save this task.');
        }
      })}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-title`}>Title</Label>
        <Input
          id={`${idPrefix}-title`}
          autoComplete="off"
          aria-invalid={errors.title ? true : undefined}
          {...register('title')}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
        <textarea
          id={`${idPrefix}-notes`}
          className={taskTextareaClassName}
          aria-invalid={errors.notes ? true : undefined}
          {...register('notes')}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-priority`}>Priority</Label>
          <Controller
            name="priority"
            control={control}
            render={({ field }) => (
              <select
                id={`${idPrefix}-priority`}
                className={taskControlClassName}
                value={field.value}
                onChange={(event) => {
                  field.onChange(event.target.value);
                }}
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABEL[priority]}
                  </option>
                ))}
              </select>
            )}
          />
        </div>
        {status ? (
          <div className="grid gap-2">
            <Label htmlFor={`${idPrefix}-status`}>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <select
                  id={`${idPrefix}-status`}
                  className={taskControlClassName}
                  value={field.value ?? status}
                  onChange={(event) => {
                    field.onChange(event.target.value);
                  }}
                >
                  {TASK_PATCH_STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {STATUS_LABEL[option]}
                    </option>
                  ))}
                </select>
              )}
            />
          </div>
        ) : (
          <p className="self-end text-sm text-muted-foreground">
            Completed tasks reopen separately.
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-due`}>Due date</Label>
        <Controller
          name="dueDate"
          control={control}
          render={({ field }) => (
            <Input
              id={`${idPrefix}-due`}
              type="date"
              value={field.value ?? ''}
              aria-invalid={errors.dueDate ? true : undefined}
              onChange={(event) => {
                field.onChange(event.target.value === '' ? null : event.target.value);
              }}
            />
          )}
        />
        <p className="text-sm text-muted-foreground">
          A calendar date, with no timezone conversion.
        </p>
      </div>
      <fieldset className="grid gap-4">
        <legend className="text-sm font-medium">Schedule ({timezone})</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="scheduledStart"
            control={control}
            render={({ field }) => (
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-start`}>Starts</Label>
                <input
                  id={`${idPrefix}-start`}
                  type="datetime-local"
                  className={taskControlClassName}
                  value={field.value ? utcToWallTime(field.value, timezone) : ''}
                  aria-invalid={errors.scheduledStart ? true : undefined}
                  onChange={(event) => {
                    const wall = event.target.value;
                    field.onChange(wall === '' ? null : wallTimeToUtc(wall, timezone));
                  }}
                />
              </div>
            )}
          />
          <Controller
            name="scheduledEnd"
            control={control}
            render={({ field }) => (
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-end`}>Ends</Label>
                <input
                  id={`${idPrefix}-end`}
                  type="datetime-local"
                  className={taskControlClassName}
                  value={field.value ? utcToWallTime(field.value, timezone) : ''}
                  aria-invalid={errors.scheduledEnd ? true : undefined}
                  onChange={(event) => {
                    const wall = event.target.value;
                    field.onChange(wall === '' ? null : wallTimeToUtc(wall, timezone));
                  }}
                />
              </div>
            )}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Set both times, or clear both. They are saved as UTC.
        </p>
      </fieldset>
      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor={`${idPrefix}-estimate`}>Estimate (minutes)</Label>
        <Controller
          name="estimatedMinutes"
          control={control}
          render={({ field }) => (
            <Input
              id={`${idPrefix}-estimate`}
              type="number"
              min={1}
              max={10080}
              step={1}
              inputMode="numeric"
              value={field.value ?? ''}
              aria-invalid={errors.estimatedMinutes ? true : undefined}
              onChange={(event) => {
                const raw = event.target.value;
                field.onChange(raw === '' ? null : Number(raw));
              }}
            />
          )}
        />
      </div>
      {messages.length > 0 ? (
        <div role="alert" className="grid gap-1 text-sm text-destructive">
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save task'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
