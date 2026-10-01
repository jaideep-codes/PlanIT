import type { NextConfig } from 'next';

/**
 * The browser only ever talks to this origin. `/api/*` is rewritten server-side to the
 * PlanIT API, which keeps auth cookies first-party and lets proxy.ts see them for route
 * protection. Rewrites are resolved at build time, so API_INTERNAL_URL must be set when
 * running `next build` as well as at runtime.
 */
function resolveApiInternalUrl(): string {
  const raw = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API_INTERNAL_URL must be an http(s) URL');
  }
  return url.origin;
}

const isProduction = process.env.NODE_ENV === 'production';

// Content-Security-Policy is set per request in src/proxy.ts because it carries a nonce.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
  ...(isProduction
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  transpilePackages: ['@planit/ui'],
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
  rewrites() {
    return Promise.resolve([
      { source: '/api/:path*', destination: `${resolveApiInternalUrl()}/api/:path*` },
    ]);
  },
};

export default nextConfig;
