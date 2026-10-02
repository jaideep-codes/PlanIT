import { describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';

import { HibpPasswordBreachChecker } from './password-breach.js';
import { PasswordService } from './password.service.js';

function service(isBreached: () => Promise<boolean>) {
  const breach = new HibpPasswordBreachChecker();
  vi.spyOn(breach, 'isBreached').mockImplementation(isBreached);
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  return new PasswordService(breach, logger);
}

describe('PasswordService', () => {
  it('verifies a real hash and still runs Argon2 when the account has none', async () => {
    const passwords = service(() => Promise.resolve(false));
    await passwords.onModuleInit();
    const hash = await passwords.hash('correct-horse');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await passwords.verify('correct-horse', hash)).toBe(true);
    expect(await passwords.verify('wrong-horse', hash)).toBe(false);
    expect(await passwords.verify('correct-horse', null)).toBe(false);
  });

  it('rejects a breached password and fails open when the check errors', async () => {
    const rejecting = service(() => Promise.resolve(true));
    await expect(rejecting.assertNotBreached('correct-horse')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const failing = service(() => Promise.reject(new Error('network down')));
    await expect(failing.assertNotBreached('correct-horse')).resolves.toBeUndefined();
  });
});
