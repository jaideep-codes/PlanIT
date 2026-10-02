import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgresql://planit:secret-password@localhost:5432/planit',
  REDIS_URL: 'redis://:secret-redis@localhost:6379/0',
  WEB_ORIGINS: 'http://localhost:3000, http://127.0.0.1:3000',
  JWT_SIGNING_KEY: 'bG9jYWwtZGV2LWp3dC1zaWduaW5nLWtleS0zMmJ5dGU=',
  OTP_PEPPER: 'bG9jYWwtZGV2LW90cC1wZXBwZXItdmFsdWUtMzJieXQ=',
  OTP_JOB_ENCRYPTION_KEY: 'bG9jYWwtZGV2LW90cC1qb2Ita2V5LTMyLWJ5dGVzISE=',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_FROM: 'PlanIT <noreply@planit.local>',
};

describe('validateEnv', () => {
  it('applies defaults and parses typed values', () => {
    const env = validateEnv(validEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.WEB_ORIGINS).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(env.TRUST_PROXY).toBe(false);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['2', 2],
    ['10.0.0.0/8', '10.0.0.0/8'],
  ])('parses TRUST_PROXY=%s', (raw, expected) => {
    expect(validateEnv({ ...validEnv, TRUST_PROXY: raw }).TRUST_PROXY).toEqual(expected);
  });

  it('rejects a missing database URL', () => {
    const { DATABASE_URL: _omitted, ...rest } = validEnv;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres database URL', () => {
    expect(() => validateEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/planit' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('requires https origins in production', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'production' })).toThrow(
      /WEB_ORIGINS: must use https in production/,
    );
  });

  it('rejects a signing key that is not 32 bytes and does not echo it', () => {
    const leaked = 'this-is-not-valid-base64-key-material';
    expect(() => validateEnv({ ...validEnv, JWT_SIGNING_KEY: leaked })).toThrow(/JWT_SIGNING_KEY/);
    try {
      validateEnv({ ...validEnv, JWT_SIGNING_KEY: leaked });
    } catch (error) {
      expect((error as Error).message).not.toContain(leaked);
    }
  });

  it('never echoes configuration values in error messages', () => {
    try {
      validateEnv({ ...validEnv, REDIS_URL: 'not a url with secret-redis', PORT: 'abc' });
      expect.unreachable('validateEnv should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/REDIS_URL/);
      expect(message).not.toContain('secret-redis');
      expect(message).not.toContain('secret-password');
    }
  });
});
