import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '@planit/shared';
import type { Response } from 'express';

import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS } from './auth.constants.js';

/**
 * Secure and HttpOnly on every environment, including http://localhost. Browsers treat
 * localhost as a secure context, so the `__Host-` prefix (which requires Secure, Path=/,
 * and no Domain) still sticks. The refresh cookie cannot use that prefix because its
 * path is the auth route, not `/`.
 */
const BASE = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
} as const;

export function writeSessionCookies(
  response: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  response.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, {
    ...BASE,
    path: '/',
    maxAge: ACCESS_TTL_SECONDS * 1000,
  });
  response.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    ...BASE,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookies(response: Response): void {
  response.clearCookie(ACCESS_COOKIE_NAME, { ...BASE, path: '/' });
  response.clearCookie(REFRESH_COOKIE_NAME, { ...BASE, path: REFRESH_COOKIE_PATH });
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
