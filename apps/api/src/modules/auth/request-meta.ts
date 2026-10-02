import type { Request } from 'express';

import { USER_AGENT_MAX_LENGTH } from './auth.constants.js';

export interface RequestMeta {
  ip: string | undefined;
  userAgent: string | null;
  requestId: string | undefined;
}

export function truncateUserAgent(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replaceAll('\0', '').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, USER_AGENT_MAX_LENGTH);
}

export function requestMeta(req: Request & { id?: unknown }): RequestMeta {
  return {
    ip: req.ip,
    userAgent: truncateUserAgent(req.get('user-agent')),
    requestId: typeof req.id === 'string' ? req.id : undefined,
  };
}
