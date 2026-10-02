'use client';

import { authSessionListSchema, sessionRevocationSchema } from '@planit/shared';
import type { AuthSessionSummary } from '@planit/types';
import { Badge } from '@planit/ui/components/badge';
import { Button } from '@planit/ui/components/button';
import { Skeleton } from '@planit/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api/api-client';

const sessionsQueryKey = ['auth', 'sessions'] as const;

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function SessionList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: sessionsQueryKey,
    queryFn: ({ signal }) => apiGet('/v1/auth/sessions', authSessionListSchema, { signal }),
  });

  const revokeOne = useMutation({
    mutationFn: (sessionId: string) =>
      apiDelete(`/v1/auth/sessions/${sessionId}`, sessionRevocationSchema),
    onSuccess: async (result) => {
      if (result.currentSessionRevoked) {
        router.push('/login');
        router.refresh();
        return;
      }
      await queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    },
  });

  const revokeOthers = useMutation({
    mutationFn: () => apiPost('/v1/auth/sessions/revoke-others', {}, sessionRevocationSchema),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    },
  });

  if (query.isPending) {
    return (
      <div className="grid gap-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading sessions</span>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="grid gap-3">
        <p role="alert" className="text-sm text-destructive">
          {query.error instanceof ApiError ? query.error.message : 'Could not load sessions.'}
        </p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const others = query.data.items.filter((session) => !session.current);
  const pending = revokeOne.isPending || revokeOthers.isPending;
  const error = revokeOne.error ?? revokeOthers.error;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {others.length === 0
            ? 'This is your only active session.'
            : `${String(others.length)} other active ${others.length === 1 ? 'session' : 'sessions'}.`}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={others.length === 0 || pending}
          onClick={() => {
            revokeOthers.mutate();
          }}
        >
          {revokeOthers.isPending ? 'Signing out…' : 'Sign out of other sessions'}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Could not update sessions.'}
        </p>
      ) : null}
      <ul className="divide-y rounded-lg border">
        {query.data.items.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            pending={pending}
            onRevoke={(sessionId) => {
              revokeOne.mutate(sessionId);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function SessionRow({
  session,
  pending,
  onRevoke,
}: {
  session: AuthSessionSummary;
  pending: boolean;
  onRevoke: (sessionId: string) => void;
}) {
  const label = session.userAgent ?? 'Unknown device';
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">
          Last used <time dateTime={session.lastUsedAt}>{formatWhen(session.lastUsedAt)}</time>
        </p>
      </div>
      {session.current ? (
        <Badge variant="secondary">This device</Badge>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`Sign out ${label}`}
          onClick={() => {
            onRevoke(session.id);
          }}
        >
          Sign out
        </Button>
      )}
    </li>
  );
}
