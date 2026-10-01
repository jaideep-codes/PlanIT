import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

// Restricting the alphabet and length keeps caller-supplied IDs from being used for
// log injection while still allowing correlation with upstream proxies.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export function resolveRequestId(incoming: string | string[] | undefined): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return candidate !== undefined && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}
