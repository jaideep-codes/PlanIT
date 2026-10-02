import { timingSafeEqual } from 'node:crypto';

import { jwtVerify, type JWTVerifyGetKey } from 'jose';

import { GoogleTokenRejected, type GoogleIdentity } from './google-oauth.types.js';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const CLOCK_TOLERANCE_SECONDS = 30;

function sameString(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string') return false;
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(actual, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verifies a Google ID token against Google's signing keys. Accepts the login only when
 * `email_verified` is the boolean `true`. The token is not returned and is not included in
 * any error.
 */
export async function verifyGoogleIdToken(
  token: string,
  jwks: JWTVerifyGetKey,
  expected: { clientId: string; nonce: string },
): Promise<GoogleIdentity> {
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, jwks, {
      algorithms: ['RS256'],
      issuer: GOOGLE_ISSUERS,
      audience: expected.clientId,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    payload = verified.payload;
  } catch {
    throw new GoogleTokenRejected('rejected');
  }

  if (
    typeof payload.exp !== 'number' ||
    typeof payload.sub !== 'string' ||
    payload.sub.length === 0
  ) {
    throw new GoogleTokenRejected('rejected');
  }
  if (!sameString(expected.nonce, payload.nonce)) throw new GoogleTokenRejected('rejected');
  if (payload.azp !== undefined && payload.azp !== expected.clientId) {
    throw new GoogleTokenRejected('rejected');
  }
  if (payload.email_verified !== true) throw new GoogleTokenRejected('unverified_email');
  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    throw new GoogleTokenRejected('rejected');
  }

  return {
    subject: payload.sub,
    email: payload.email,
    emailVerified: true,
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}
