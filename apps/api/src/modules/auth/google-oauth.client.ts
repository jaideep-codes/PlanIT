import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { PinoLogger } from 'nestjs-pino';

import { verifyGoogleIdToken } from './google-id-token.js';
import {
  GoogleEndpointError,
  GoogleExchangeUnavailable,
  GoogleTokenRejected,
  type GoogleCodeExchange,
  type GoogleIdentity,
} from './google-oauth.types.js';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export const GOOGLE_IDENTITY_EXCHANGE = Symbol('GOOGLE_IDENTITY_EXCHANGE');

export interface GoogleIdentityExchange {
  exchange(input: GoogleCodeExchange): Promise<GoogleIdentity>;
}

export interface GoogleTokenDependencies {
  fetchImpl: typeof fetch;
  verifyIdToken: (token: string, nonce: string, clientId: string) => Promise<GoogleIdentity>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Exchanges an authorization code at Google's token endpoint. The request body carries the
 * client secret and PKCE verifier. The response's access token is discarded; only the ID
 * token is verified, and it is not logged.
 */
export async function exchangeGoogleAuthorizationCode(
  input: GoogleCodeExchange,
  dependencies: GoogleTokenDependencies,
): Promise<GoogleIdentity> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });

  let response: Response;
  try {
    response = await dependencies.fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new GoogleExchangeUnavailable();
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new GoogleEndpointError(response.status);
  }

  const parsed: unknown = await response.json().catch(() => null);
  const idToken = isRecord(parsed) && typeof parsed.id_token === 'string' ? parsed.id_token : null;
  if (!idToken) throw new GoogleTokenRejected('rejected');
  return dependencies.verifyIdToken(idToken, input.nonce, input.clientId);
}

@Injectable()
export class GoogleOAuthHttpClient implements GoogleIdentityExchange {
  private readonly jwks: JWTVerifyGetKey;

  constructor(private readonly logger: PinoLogger) {
    logger.setContext(GoogleOAuthHttpClient.name);
    this.jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  }

  async exchange(input: GoogleCodeExchange): Promise<GoogleIdentity> {
    try {
      return await exchangeGoogleAuthorizationCode(input, {
        fetchImpl: fetch,
        verifyIdToken: (token, nonce, clientId) =>
          verifyGoogleIdToken(token, this.jwks, { nonce, clientId }),
      });
    } catch (error) {
      if (error instanceof GoogleTokenRejected || error instanceof GoogleExchangeUnavailable) {
        throw error;
      }
      if (error instanceof GoogleEndpointError) {
        this.logger.warn({ status: error.status }, 'Google token endpoint failed');
        if (error.status >= 500) throw new GoogleExchangeUnavailable();
        throw new GoogleTokenRejected('rejected');
      }
      this.logger.warn({ reason: 'google_unreachable' }, 'Google token endpoint failed');
      throw new GoogleExchangeUnavailable();
    }
  }
}
