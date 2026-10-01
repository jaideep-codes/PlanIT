import { apiErrorBodySchema } from '@planit/shared';
import type { z } from 'zod';

/** Error raised for any failed API call. `code` comes from the API's error envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
export const INVALID_RESPONSE_CODE = 'INVALID_RESPONSE';

export interface ApiRequestOptions {
  signal?: AbortSignal;
  /** Non-2xx statuses whose body should be parsed with `schema` instead of treated as errors. */
  acceptStatuses?: readonly number[];
}

/**
 * GETs a same-origin `/api` path (proxied to the PlanIT API) and validates the response
 * against `schema`. Responses are never trusted just because they came from our backend.
 */
export async function apiGet<T>(
  path: `/${string}`,
  schema: z.ZodType<T>,
  options: ApiRequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, NETWORK_ERROR_CODE, 'Could not reach PlanIT. Check your connection.');
  }

  const body: unknown = await response.json().catch(() => undefined);
  const accepted = response.ok || (options.acceptStatuses?.includes(response.status) ?? false);

  if (!accepted) {
    const envelope = apiErrorBodySchema.safeParse(body);
    if (envelope.success) {
      const { code, message, requestId } = envelope.data.error;
      throw new ApiError(response.status, code, message, requestId);
    }
    throw new ApiError(response.status, INVALID_RESPONSE_CODE, 'Unexpected response from PlanIT.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(response.status, INVALID_RESPONSE_CODE, 'Unexpected response from PlanIT.');
  }
  return parsed.data;
}
