import { describe, expect, it, vi } from 'vitest';

import { HibpPasswordBreachChecker, rangeContainsSuffix, sha1Password } from './password-breach.js';

describe('HIBP range parser', () => {
  it('matches a suffix and ignores padding rows', () => {
    const digest = sha1Password('password');
    const suffix = digest.slice(5);
    const body = `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0\n${suffix}:12\n`;
    expect(rangeContainsSuffix(body, suffix)).toBe(true);
    expect(rangeContainsSuffix(body, 'BBB')).toBe(false);
  });
});

describe('HibpPasswordBreachChecker', () => {
  it('sends only the hash prefix', async () => {
    const digest = sha1Password('correct-horse');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(`${digest.slice(5)}:3\n`, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const checker = new HibpPasswordBreachChecker();
    await expect(checker.isBreached('correct-horse')).resolves.toBe(true);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url.endsWith(digest.slice(0, 5))).toBe(true);
    expect(url).not.toContain(digest.slice(5));
    expect(url).not.toContain('correct-horse');
    vi.unstubAllGlobals();
  });
});
