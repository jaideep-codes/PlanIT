import { describe, expect, it } from 'vitest';

import { ERROR_CODES, isErrorCode } from './errors.js';

describe('isErrorCode', () => {
  it('accepts every catalogued code', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(isErrorCode(code)).toBe(true);
    }
  });

  it('rejects unknown values and inherited object keys', () => {
    expect(isErrorCode('SOMETHING_ELSE')).toBe(false);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});
