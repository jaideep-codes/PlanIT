import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { describe, expect, it } from 'vitest';

import { verifyGoogleIdToken } from './google-id-token.js';
import { GoogleTokenRejected } from './google-oauth.types.js';

const CLIENT_ID = 'google-client-id';
const NONCE = 'nonce-value-not-a-token';

async function keys() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

async function sign(
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'],
  claims: Record<string, unknown>,
  options?: { issuer?: string; audience?: string; expires?: string; subject?: string },
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(options?.issuer ?? 'https://accounts.google.com')
    .setAudience(options?.audience ?? CLIENT_ID)
    .setSubject(options?.subject ?? 'google-subject-1')
    .setIssuedAt()
    .setExpirationTime(options?.expires ?? '5m')
    .sign(privateKey);
}

async function accept(token: string, jwks: JWTVerifyGetKey, nonce = NONCE) {
  return verifyGoogleIdToken(token, jwks, { clientId: CLIENT_ID, nonce });
}

describe('Google ID tokens', () => {
  it('accepts a token signed by the Google key set when the email is verified', async () => {
    const { privateKey, jwks } = await keys();
    const token = await sign(privateKey, {
      email: 'ada@example.com',
      email_verified: true,
      nonce: NONCE,
      name: 'Ada Lovelace',
    });

    await expect(accept(token, jwks)).resolves.toEqual({
      subject: 'google-subject-1',
      email: 'ada@example.com',
      emailVerified: true,
      name: 'Ada Lovelace',
    });
  });

  it('rejects an unverified email, a string true, a bad nonce, and a bad signature', async () => {
    const { privateKey, jwks } = await keys();
    const other = await generateKeyPair('RS256', { extractable: true });
    const unverified = await sign(privateKey, {
      email: 'ada@example.com',
      email_verified: false,
      nonce: NONCE,
    });
    const stringTrue = await sign(privateKey, {
      email: 'ada@example.com',
      email_verified: 'true',
      nonce: NONCE,
    });
    const badNonce = await sign(privateKey, {
      email: 'ada@example.com',
      email_verified: true,
      nonce: 'other-nonce',
    });
    const forged = await sign(other.privateKey, {
      email: 'ada@example.com',
      email_verified: true,
      nonce: NONCE,
    });

    await expect(accept(unverified, jwks)).rejects.toMatchObject({ reason: 'unverified_email' });
    await expect(accept(stringTrue, jwks)).rejects.toMatchObject({ reason: 'unverified_email' });
    await expect(accept(badNonce, jwks)).rejects.toMatchObject({ reason: 'rejected' });
    await expect(accept(forged, jwks)).rejects.toBeInstanceOf(GoogleTokenRejected);

    try {
      await accept(forged, jwks);
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleTokenRejected);
      expect((error as Error).message).not.toContain(forged);
      expect((error as Error).message).not.toContain('ada@example.com');
    }
  });

  it('rejects the wrong audience, issuer, and an expired token', async () => {
    const { privateKey, jwks } = await keys();
    const claims = { email: 'ada@example.com', email_verified: true, nonce: NONCE };
    await expect(
      accept(await sign(privateKey, claims, { audience: 'other-client' }), jwks),
    ).rejects.toMatchObject({ reason: 'rejected' });
    await expect(
      accept(await sign(privateKey, claims, { issuer: 'https://evil.example' }), jwks),
    ).rejects.toMatchObject({ reason: 'rejected' });
    await expect(
      accept(await sign(privateKey, claims, { expires: '-2m' }), jwks),
    ).rejects.toMatchObject({ reason: 'rejected' });
    await expect(
      accept(await sign(privateKey, claims, { issuer: 'accounts.google.com' }), jwks),
    ).resolves.toMatchObject({ emailVerified: true });
  });
});
