import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { sha256Hex } from './crypto.js';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export function randomOAuthSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** S256 code challenge from a PKCE verifier (RFC 7636). */
export function pkceS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function googleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** The OAuth state cookie holds this hash, not the raw state. */
export function oauthStateCookieMatches(state: string, cookie: string | undefined): boolean {
  if (!cookie || cookie.length !== 64) return false;
  const expected = Buffer.from(sha256Hex(state), 'utf8');
  const actual = Buffer.from(cookie, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
