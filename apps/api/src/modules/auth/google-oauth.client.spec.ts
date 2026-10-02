import { describe, expect, it, vi } from 'vitest';

import { exchangeGoogleAuthorizationCode, GOOGLE_TOKEN_URL } from './google-oauth.client.js';
import { GoogleEndpointError, GoogleExchangeUnavailable } from './google-oauth.types.js';

const input = {
  code: 'auth-code-do-not-store',
  codeVerifier: 'pkce-verifier-value',
  nonce: 'nonce-value',
  clientId: 'google-client-id',
  clientSecret: 'google-client-secret-value',
  redirectUri: 'http://localhost:3000/api/v1/auth/google/callback',
};

describe('Google token exchange', () => {
  it('posts the verifier and client secret to the token endpoint and verifies only the ID token', async () => {
    const fetchImpl = vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe(GOOGLE_TOKEN_URL);
      expect(url).not.toContain(input.clientSecret);
      expect(url).not.toContain(input.codeVerifier);
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      if (!(init.body instanceof URLSearchParams)) {
        throw new Error('Expected a form body');
      }
      const body = init.body.toString();
      expect(body).toContain(`code=${input.code}`);
      expect(body).toContain(`code_verifier=${input.codeVerifier}`);
      expect(body).toContain(`client_secret=${input.clientSecret}`);
      expect(body).toContain('grant_type=authorization_code');
      return Promise.resolve(
        new Response(JSON.stringify({ id_token: 'signed-id-token', access_token: 'discard-me' }), {
          status: 200,
        }),
      );
    });
    const verifyIdToken = vi.fn((token: string, nonce: string, clientId: string) => {
      expect(token).toBe('signed-id-token');
      expect(nonce).toBe(input.nonce);
      expect(clientId).toBe(input.clientId);
      return Promise.resolve({
        subject: 'google-subject-1',
        email: 'ada@example.com',
        emailVerified: true,
        name: null,
      });
    });

    await expect(
      exchangeGoogleAuthorizationCode(input, {
        fetchImpl: fetchImpl as typeof fetch,
        verifyIdToken,
      }),
    ).resolves.toMatchObject({ emailVerified: true });
    expect(verifyIdToken).toHaveBeenCalledTimes(1);
  });

  it('discards an error body and does not treat a transport failure as success', async () => {
    const denied = vi.fn(() =>
      Promise.resolve(new Response('leaked-authorization-code', { status: 400 })),
    );
    await expect(
      exchangeGoogleAuthorizationCode(input, {
        fetchImpl: denied,
        verifyIdToken: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(GoogleEndpointError);

    try {
      await exchangeGoogleAuthorizationCode(input, {
        fetchImpl: denied,
        verifyIdToken: vi.fn(),
      });
    } catch (error) {
      expect((error as Error).message).not.toContain('leaked-authorization-code');
      expect((error as Error).message).not.toContain(input.code);
    }

    await expect(
      exchangeGoogleAuthorizationCode(input, {
        fetchImpl: vi.fn(() => Promise.reject(new Error(`down ${input.clientSecret}`))),
        verifyIdToken: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(GoogleExchangeUnavailable);
  });
});
