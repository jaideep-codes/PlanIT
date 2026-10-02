import { describe, expect, it } from 'vitest';

import { openSealedPayload, sealPayload } from './sealed-payload.js';

const KEY = Buffer.from('bG9jYWwtZGV2LW90cC1qb2Ita2V5LTMyLWJ5dGVzISE=', 'base64');

describe('sealed email payloads', () => {
  it('round-trips and does not leave the code or address in the sealed object', () => {
    const message = {
      to: 'ada@example.com',
      subject: 'Your PlanIT verification code',
      text: 'Your PlanIT verification code is 482913.',
    };
    const sealed = sealPayload(KEY, message);
    expect(Object.keys(sealed).sort()).toEqual(['ciphertext', 'iv', 'tag', 'v']);
    // '@' cannot appear in base64url, so a leaked address would show up here.
    expect(JSON.stringify(sealed)).not.toContain('@');
    expect(sealed.ciphertext).not.toBe('482913');
    expect(openSealedPayload(KEY, sealed)).toEqual(message);
  });
});
