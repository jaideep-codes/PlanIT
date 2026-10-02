import { describe, expect, it } from 'vitest';

import { otpCodeHash, otpMatches, signAccessToken, verifyAccessToken } from './crypto.js';

const KEY = Buffer.from('bG9jYWwtZGV2LWp3dC1zaWduaW5nLWtleS0zMmJ5dGU=', 'base64');
const PEPPER = Buffer.from('bG9jYWwtZGV2LW90cC1wZXBwZXItdmFsdWUtMzJieXQ=', 'base64');

describe('access tokens', () => {
  it('signs a token whose payload is only sub, sid, and exp', () => {
    const token = signAccessToken(KEY, { sub: 'user-1', sid: 'session-1' }, 1_700_000_000);
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as unknown;
    expect(typeof payload).toBe('object');
    expect(payload).not.toBeNull();
    expect(Object.keys(payload as object).sort()).toEqual(['exp', 'sid', 'sub']);
    expect(verifyAccessToken(KEY, token, 1_700_000_000)).toEqual({
      sub: 'user-1',
      sid: 'session-1',
      exp: 1_700_000_000 + 15 * 60,
    });
  });

  it('rejects a tampered token, a bad signature, and an expired token', () => {
    const token = signAccessToken(KEY, { sub: 'user-1', sid: 'session-1' }, 1_700_000_000);
    const [header, payload, signature] = token.split('.');
    expect(verifyAccessToken(KEY, `${header}.${payload}.aaaa`, 1_700_000_000)).toBeNull();
    expect(verifyAccessToken(KEY, `${header}.${payload}.${signature}x`, 1_700_000_000)).toBeNull();
    expect(verifyAccessToken(KEY, token, 1_700_000_000 + 15 * 60)).toBeNull();
  });
});

describe('OTP hashes', () => {
  it('matches only the same code and pepper', () => {
    const hash = otpCodeHash(PEPPER, '123456');
    expect(hash).toHaveLength(64);
    expect(otpMatches(PEPPER, '123456', hash)).toBe(true);
    expect(otpMatches(PEPPER, '123457', hash)).toBe(false);
    expect(otpMatches(KEY, '123456', hash)).toBe(false);
  });
});
