/** Values stored on `UserPreference.theme` and returned to the owner in lowercase. */
export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * Owner-only account projection. `passwordHash` is never part of this contract.
 * `theme` is the saved preference; the browser may cache the same value for first paint.
 */
export interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  emailVerifiedAt: string | null;
  theme: ThemePreference;
  createdAt: string;
}
