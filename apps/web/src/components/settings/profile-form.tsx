'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { currentUserSchema, updateCurrentUserRequestSchema } from '@planit/shared';
import { Button } from '@planit/ui/components/button';
import { Skeleton } from '@planit/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { AuthField } from '@/components/auth/auth-field';
import { ApiError, apiGet, apiPatch } from '@/lib/api/api-client';

export const currentUserQueryKey = ['users', 'me'] as const;

export function ProfileForm() {
  const query = useQuery({
    queryKey: currentUserQueryKey,
    queryFn: ({ signal }) => apiGet('/v1/users/me', currentUserSchema, { signal }),
  });

  if (query.isPending) {
    return (
      <div className="grid gap-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading profile</span>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="grid gap-3">
        <p role="alert" className="text-sm text-destructive">
          {query.error instanceof ApiError ? query.error.message : 'Could not load your profile.'}
        </p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return <ProfileFields user={query.data} />;
}

function ProfileFields({
  user,
}: {
  user: { id: string; email: string; displayName: string | null; timezone: string };
}) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(updateCurrentUserRequestSchema),
    defaultValues: {
      displayName: user.displayName ?? '',
      timezone: user.timezone,
    },
  });

  const save = useMutation({
    mutationFn: (values: { displayName?: string | null; timezone?: string }) =>
      apiPatch('/v1/users/me', values, currentUserSchema),
    onSuccess: async (saved) => {
      setNotice('Saved.');
      setFormError(null);
      await queryClient.setQueryData(currentUserQueryKey, saved);
    },
  });

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={handleSubmit(async (values) => {
        setNotice(null);
        setFormError(null);
        try {
          await save.mutateAsync(values);
        } catch (error) {
          setFormError(error instanceof ApiError ? error.message : 'Could not save your profile.');
        }
      })}
    >
      <AuthField id="profile-email" label="Email" type="email" value={user.email} readOnly />
      <AuthField
        id="profile-display-name"
        label="Display name"
        type="text"
        autoComplete="nickname"
        maxLength={50}
        error={errors.displayName?.message}
        {...register('displayName')}
      />
      <AuthField
        id="profile-timezone"
        label="Timezone"
        type="text"
        autoComplete="off"
        spellCheck={false}
        required
        placeholder="Asia/Kolkata"
        error={errors.timezone?.message}
        {...register('timezone')}
      />
      <p className="text-sm text-muted-foreground">
        Use an IANA timezone name, such as Asia/Kolkata or America/New_York.
      </p>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  );
}
