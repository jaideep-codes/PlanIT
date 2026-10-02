import { describe, expect, it } from 'vitest';

import {
  loginRequestSchema,
  otpVerifyRequestSchema,
  passwordResetRequestSchema,
  signupRequestSchema,
} from './auth.js';

describe('auth request schemas', () => {
  it('normalises email and accepts a password with each required class', () => {
    expect(
      signupRequestSchema.parse({ email: ' Ada@Example.com ', password: 'Correct-horse1' }),
    ).toEqual({
      email: 'ada@example.com',
      password: 'Correct-horse1',
    });
  });

  it('rejects a signup password that misses a required class', () => {
    const result = signupRequestSchema.safeParse({
      email: 'ada@example.com',
      password: 'correct-horse',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('uppercase'))).toBe(true);
      expect(result.error.issues.some((issue) => issue.message.includes('number'))).toBe(true);
    }
  });

  it('rejects a short signup password and accepts that same password on login', () => {
    expect(
      signupRequestSchema.safeParse({ email: 'ada@example.com', password: 'short' }).success,
    ).toBe(false);
    expect(
      loginRequestSchema.safeParse({ email: 'ada@example.com', password: 'short' }).success,
    ).toBe(true);
    expect(
      loginRequestSchema.safeParse({
        email: 'ada@example.com',
        password: 'correct-horse',
        userId: 'someone-else',
      }).success,
    ).toBe(false);
  });

  it('uses the signup password rule for reset and rejects extra fields', () => {
    expect(
      passwordResetRequestSchema.safeParse({
        email: 'ada@example.com',
        code: '123456',
        password: 'correct-horse',
      }).success,
    ).toBe(false);
    expect(
      passwordResetRequestSchema.parse({
        email: ' Ada@Example.com ',
        code: '123456',
        password: 'Correct-horse1',
      }),
    ).toEqual({
      email: 'ada@example.com',
      code: '123456',
      password: 'Correct-horse1',
    });
    expect(
      passwordResetRequestSchema.safeParse({
        email: 'ada@example.com',
        code: '123456',
        password: 'Correct-horse1',
        userId: 'someone-else',
      }).success,
    ).toBe(false);
  });

  it('accepts only a 6-digit code', () => {
    expect(
      otpVerifyRequestSchema.safeParse({ email: 'ada@example.com', code: '12345' }).success,
    ).toBe(false);
    expect(
      otpVerifyRequestSchema.safeParse({ email: 'ada@example.com', code: '123456' }).success,
    ).toBe(true);
  });
});
