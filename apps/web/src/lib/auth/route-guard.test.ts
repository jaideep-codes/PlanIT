import { describe, expect, it } from 'vitest';

import { authRedirectPath } from './route-guard';

describe('authRedirectPath', () => {
  it('sends an anonymous visit to the app shell to login', () => {
    expect(authRedirectPath('/', false)).toBe('/login');
    expect(authRedirectPath('/calendar', false)).toBe('/login?next=%2Fcalendar');
  });

  it('leaves the credential pages available without a session', () => {
    expect(authRedirectPath('/login', false)).toBeNull();
    expect(authRedirectPath('/signup', false)).toBeNull();
    expect(authRedirectPath('/verify-email', false)).toBeNull();
    expect(authRedirectPath('/logout', false)).toBeNull();
    expect(authRedirectPath('/forgot-password', false)).toBeNull();
    expect(authRedirectPath('/reset-password', false)).toBeNull();
  });

  it('sends a signed-in visit to the sign-in forms home', () => {
    expect(authRedirectPath('/login', true)).toBe('/');
    expect(authRedirectPath('/calendar', true)).toBeNull();
    expect(authRedirectPath('/logout', true)).toBeNull();
  });
});
