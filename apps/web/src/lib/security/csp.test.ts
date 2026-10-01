import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy, generateNonce } from './csp';

function directive(policy: string, name: string): string | undefined {
  return policy.split('; ').find((entry) => entry === name || entry.startsWith(`${name} `));
}

describe('buildContentSecurityPolicy', () => {
  it('locks production scripts to the request nonce', () => {
    const policy = buildContentSecurityPolicy({ nonce: 'abc123', isDevelopment: false });
    expect(directive(policy, 'script-src')).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    );
    expect(policy).not.toContain('unsafe-eval');
    expect(directive(policy, 'style-src')).toBe("style-src 'self' 'nonce-abc123'");
    expect(directive(policy, 'upgrade-insecure-requests')).toBeDefined();
  });

  it('only allows unsafe-eval in development', () => {
    const policy = buildContentSecurityPolicy({ nonce: 'n', isDevelopment: true });
    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(policy, 'upgrade-insecure-requests')).toBeUndefined();
  });

  it('forbids framing, plugins, and cross-origin connections', () => {
    const policy = buildContentSecurityPolicy({ nonce: 'n', isDevelopment: false });
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
  });
});

describe('generateNonce', () => {
  it('returns a distinct base64 value of 128 bits each call', () => {
    const first = generateNonce();
    const second = generateNonce();
    expect(first).not.toBe(second);
    expect(atob(first)).toHaveLength(16);
  });
});
