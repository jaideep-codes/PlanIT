import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { googleSignInErrorMessage, isGoogleSignInConfigured } from '@/lib/auth/google-sign-in';

describe('Google sign-in button', () => {
  it('says Google sign-in is not configured when credentials are absent', () => {
    render(<GoogleSignInButton available={false} />);
    const button = screen.getByRole('button', { name: 'Google sign-in is not configured' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('links to the API start route when Google is configured', () => {
    render(<GoogleSignInButton available />);
    const link = screen.getByRole('link', { name: 'Continue with Google' });
    expect(link.getAttribute('href')).toBe('/api/v1/auth/google/start');
  });
});

describe('Google sign-in status', () => {
  it('ignores callback query values outside the allowlist', () => {
    expect(googleSignInErrorMessage('verify_email')).toBe(
      'Verify your email before linking Google.',
    );
    expect(googleSignInErrorMessage('unverified_email')).toBe(
      'Google has not verified this email.',
    );
    expect(googleSignInErrorMessage('failed')).toBe('Google sign-in could not be completed.');
    expect(googleSignInErrorMessage('auth-code-do-not-store')).toBeNull();
    expect(googleSignInErrorMessage(undefined)).toBeNull();
  });

  it('reads availability from the API and treats a failure as not configured', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('API_INTERNAL_URL', 'http://127.0.0.1:4000');
    await expect(isGoogleSignInConfigured()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/api/v1/auth/google/start',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        redirect: 'error',
      }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down'))),
    );
    await expect(isGoogleSignInConfigured()).resolves.toBe(false);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
