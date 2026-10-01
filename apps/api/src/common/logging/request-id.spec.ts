import { describe, expect, it } from 'vitest';

import { resolveRequestId } from './request-id.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a well-formed caller-supplied ID', () => {
    expect(resolveRequestId('edge-1234abcd')).toBe('edge-1234abcd');
  });

  it('uses the first value when the header is repeated', () => {
    expect(resolveRequestId(['first-123456', 'second-123456'])).toBe('first-123456');
  });

  it.each([
    ['missing', undefined],
    ['too short', 'abc'],
    ['log injection', 'abc12345\n{"level":"fatal"}'],
    ['too long', 'a'.repeat(129)],
  ])('generates a UUID when the incoming ID is %s', (_label, incoming) => {
    expect(resolveRequestId(incoming)).toMatch(UUID_PATTERN);
  });
});
