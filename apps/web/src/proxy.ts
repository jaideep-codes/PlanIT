import { type NextRequest, NextResponse } from 'next/server';

import { buildContentSecurityPolicy, generateNonce, NONCE_HEADER } from '@/lib/security/csp';

/**
 * Runs before every page render. Today it only attaches a fresh CSP nonce; Phase 2 adds
 * session-cookie route protection here. Authorization is still always enforced by the API.
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

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
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
