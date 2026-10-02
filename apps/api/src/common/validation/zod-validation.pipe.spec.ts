import { signupRequestSchema } from '@planit/shared';
import { describe, expect, it } from 'vitest';

import { AppException } from '../errors/app.exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(signupRequestSchema);

  it('does not echo passwordHash or the submitted secret when a field is unknown', () => {
    const secret = '$argon2id$v=19$leak';
    expect(() =>
      pipe.transform({
        email: 'ada@example.com',
        password: 'Correct-horse1',
        passwordHash: secret,
      }),
    ).toThrow(AppException);

    try {
      pipe.transform({
        email: 'ada@example.com',
        password: 'Correct-horse1',
        passwordHash: secret,
      });
    } catch (error) {
      const body = JSON.stringify(error);
      expect(body).not.toMatch(/passwordHash|password_hash|\$argon2/i);
      expect(body).not.toContain(secret);
      expect(body).toContain('Unrecognized field.');
    }
  });
});
