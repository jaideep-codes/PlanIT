import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api-client';

const DEFAULT_STALE_TIME_MS = 30_000;
const MAX_RETRIES = 2;

/**
 * TanStack Query holds server state; the API stays the source of truth. Client errors (4xx)
 * are not retried because repeating them cannot succeed.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.isClientError) return false;
          return failureCount < MAX_RETRIES;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
