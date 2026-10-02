import { googleSignInAvailabilitySchema } from '@planit/shared';

const GOOGLE_SIGN_IN_ERRORS = {
  failed: 'Google sign-in could not be completed.',
  unverified_email: 'Google has not verified this email.',
  verify_email: 'Verify your email before linking Google.',
} as const;

/** Turns the callback's allowlisted query into a message. Anything else is ignored. */
export function googleSignInErrorMessage(value: string | undefined): string | null {
  if (!value || !(value in GOOGLE_SIGN_IN_ERRORS)) return null;
  return GOOGLE_SIGN_IN_ERRORS[value as keyof typeof GOOGLE_SIGN_IN_ERRORS];
}

/**
 * Asks the API whether Google credentials are configured. A failure is treated as not
 * configured so the page never offers a login the API cannot complete.
 */
export async function isGoogleSignInConfigured(): Promise<boolean> {
  const base = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
  try {
    const response = await fetch(`${base}/api/v1/auth/google/start`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    const parsed = googleSignInAvailabilitySchema.safeParse(body);
    return parsed.success && parsed.data.available;
  } catch {
    return false;
  }
}
