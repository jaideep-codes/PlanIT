import { readinessResponseSchema } from '@planit/shared';
import type { ReadinessResponse } from '@planit/types';

import { apiGet } from './api-client';

export const healthQueryKeys = {
  readiness: ['health', 'readiness'] as const,
};

/** A not-ready API answers 503 with a valid readiness body, which is data, not an error. */
export function fetchReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
  return apiGet('/health/ready', readinessResponseSchema, { signal, acceptStatuses: [503] });
}
