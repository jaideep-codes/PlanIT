/** Request header through which proxy.ts hands the per-request nonce to server components. */
export const NONCE_HEADER = 'x-nonce';

export interface CspOptions {
  nonce: string;
  isDevelopment: boolean;
}

/**
 * Builds the per-request Content-Security-Policy for HTML responses.
 *
 * - Scripts: only nonce-bearing scripts and what they load ('strict-dynamic'). Development
 *   adds 'unsafe-eval', which React uses for debugging; production never does.
 * - Styles: nonce-bearing <style> elements in production. Style *attributes* are allowed via
 *   style-src-attr because server-rendered components may emit them; attribute CSS cannot load
 *   resources outside the policy.
 * - connect-src is same-origin only. Phase 11 (BYOK) will add the specific AI provider origins
 *   the browser calls directly — never a wildcard.
 */
export function buildContentSecurityPolicy({ nonce, isDevelopment }: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ],
    'style-src': ["'self'", isDevelopment ? "'unsafe-inline'" : `'nonce-${nonce}'`],
    'style-src-attr': ["'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    ...(isDevelopment ? {} : { 'upgrade-insecure-requests': [] }),
  };

  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(' '))
    .join('; ');
}

/** 128 bits from the platform CSPRNG, base64-encoded. Works in both Node and edge runtimes. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
