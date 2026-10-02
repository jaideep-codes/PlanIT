import { type NextRequest, NextResponse } from 'next/server';

import { ACCESS_COOKIE_NAME, authRedirectPath } from '@/lib/auth/route-guard';
import { buildContentSecurityPolicy, generateNonce, NONCE_HEADER } from '@/lib/security/csp';

function withPolicy(response: NextResponse, policy: string): NextResponse {
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

/**
 * Attaches a CSP nonce and sends anonymous visits to the app shell to the login page.
 * That redirect is UX only. Every API route is still enforced by the session guard.
 */
export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === 'development',
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  // Next.js reads the nonce from this request header and applies it to its own scripts.
  requestHeaders.set('Content-Security-Policy', policy);

  const redirectPath = authRedirectPath(
    request.nextUrl.pathname,
    request.cookies.has(ACCESS_COOKIE_NAME),
  );
  if (redirectPath) {
    return withPolicy(NextResponse.redirect(new URL(redirectPath, request.url)), policy);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return withPolicy(response, policy);
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
