import { describe, expect, it } from 'vitest';

import { isOtpDueForDeletion } from './otp-retention.js';

describe('OTP retention', () => {
  const now = new Date('2026-10-02T12:00:00.000Z');

  it('keeps a code that expired less than a day ago', () => {
    const expiresAt = new Date('2026-10-01T12:00:01.000Z');
    expect(isOtpDueForDeletion(expiresAt, now)).toBe(false);
  });

  it('deletes a code only after expiry plus 24 hours', () => {
    const expiresAt = new Date('2026-10-01T12:00:00.000Z');
    expect(isOtpDueForDeletion(expiresAt, now)).toBe(true);
    expect(isOtpDueForDeletion(new Date('2026-10-02T11:00:00.000Z'), now)).toBe(false);
  });
});
