'use client';

import type { DependencyCheck, ReadinessResponse } from '@planit/types';
import { Badge } from '@planit/ui/components/badge';
import { Button } from '@planit/ui/components/button';
import { Skeleton } from '@planit/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { ApiError } from '@/lib/api/api-client';
import { fetchReadiness, healthQueryKeys } from '@/lib/api/health';

const OVERALL_LABEL: Record<ReadinessResponse['status'], string> = {
  ready: 'All systems operational',
  degraded: 'Degraded — caching unavailable',
  not_ready: 'Unavailable — database unreachable',
};

const OVERALL_VARIANT = {
  ready: 'success',
  degraded: 'warning',
  not_ready: 'destructive',
} as const;

function DependencyRow({ name, check }: { name: string; check: DependencyCheck }) {
  const up = check.status === 'up';
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span>{name}</span>
      <span className="flex items-center gap-3">
        <span className="text-muted-foreground tabular-nums">{check.latencyMs} ms</span>
        <Badge variant={up ? 'success' : 'destructive'}>{up ? 'Up' : 'Down'}</Badge>
      </span>
    </div>
  );
}

export function SystemStatus() {
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: healthQueryKeys.readiness,
    queryFn: ({ signal }) => fetchReadiness(signal),
  });

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div aria-live="polite">
          {isPending && <Skeleton className="h-5 w-48" />}
          {data !== undefined && (
            <Badge variant={OVERALL_VARIANT[data.status]}>{OVERALL_LABEL[data.status]}</Badge>
          )}
          {error !== null && data === undefined && (
            <Badge variant="destructive">
              {error instanceof ApiError ? error.message : 'Could not check status.'}
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Refresh system status"
        >
          <RefreshCw className={isFetching ? 'animate-spin' : undefined} aria-hidden="true" />
          Refresh
        </Button>
      </div>
      {data !== undefined && (
        <div className="divide-y rounded-lg border px-4">
          <DependencyRow name="Database" check={data.checks.database} />
          <DependencyRow name="Cache (Redis)" check={data.checks.redis} />
        </div>
      )}
    </div>
  );
}
