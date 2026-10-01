import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgresql://planit:secret-password@localhost:5432/planit',
  REDIS_URL: 'redis://:secret-redis@localhost:6379/0',
  WEB_ORIGINS: 'http://localhost:3000, http://127.0.0.1:3000',
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
