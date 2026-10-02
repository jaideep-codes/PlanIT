import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '@planit/shared';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import {
  readCookie,
  writeOAuthStateCookie,
  clearOAuthStateCookie,
  writeSessionCookies,
} from './auth.cookies.js';

describe('session cookies', () => {
  it('sets a __Host- access cookie and a path-scoped refresh cookie, both Secure', () => {
    const cookie = vi.fn();
    writeSessionCookies({ cookie } as unknown as Response, {
      accessToken: 'access',
      refreshToken: 'refresh',
    });
    expect(cookie).toHaveBeenCalledWith(
      ACCESS_COOKIE_NAME,
      'access',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
    );
    expect(cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'refresh',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: REFRESH_COOKIE_PATH,
      }),
    );
    expect(ACCESS_COOKIE_NAME.startsWith('__Host-')).toBe(true);
    expect(REFRESH_COOKIE_NAME.startsWith('__Host-')).toBe(false);
    const accessOptions = cookie.mock.calls[0]?.[2] as { domain?: string };
    const refreshOptions = cookie.mock.calls[1]?.[2] as { domain?: string };
    expect(accessOptions.domain).toBeUndefined();
    expect(refreshOptions.domain).toBeUndefined();
  });

  it('reads one named cookie', () => {
    expect(readCookie('a=1; planit_refresh=abc%2B; b=2', REFRESH_COOKIE_NAME)).toBe('abc+');
    expect(readCookie(undefined, ACCESS_COOKIE_NAME)).toBeUndefined();
  });

  it('sets the Google state cookie as HttpOnly, Secure, and SameSite=Lax', () => {
    const cookie = vi.fn();
    const clearCookie = vi.fn();
    writeOAuthStateCookie({ cookie } as unknown as Response, 'a'.repeat(64));
    clearOAuthStateCookie({ clearCookie } as unknown as Response);
    expect(cookie).toHaveBeenCalledWith(
      'planit_oauth_state',
      'a'.repeat(64),
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: REFRESH_COOKIE_PATH,
      }),
    );
    const options = cookie.mock.calls[0]?.[2] as { domain?: string };
    expect(options.domain).toBeUndefined();
    expect(clearCookie).toHaveBeenCalledWith(
      'planit_oauth_state',
      expect.objectContaining({ path: REFRESH_COOKIE_PATH, httpOnly: true, secure: true }),
    );
  });
});
