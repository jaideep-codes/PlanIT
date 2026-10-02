import { ACCESS_COOKIE_NAME } from '@planit/shared';

/** Pages that render without a session cookie. This is UX only; the API still checks the session. */
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/verify-email',
  '/logout',
  '/forgot-password',
  '/reset-password',
] as const;

export { ACCESS_COOKIE_NAME };

export function isPublicAppPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Where to send the browser, or null to render the requested page.
 * Authenticated visits to the sign-in forms go home. Everything else without a
 * session cookie goes to login. Authorization remains the API's job.
 */
export function authRedirectPath(pathname: string, hasSession: boolean): string | null {
  if (hasSession && (pathname === '/login' || pathname === '/signup')) return '/';
  if (!hasSession && !isPublicAppPath(pathname)) {
    if (pathname === '/') return '/login';
    return `/login?next=${encodeURIComponent(pathname)}`;
  }
  return null;
}
