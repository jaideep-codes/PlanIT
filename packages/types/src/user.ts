/** Values stored on `UserPreference.theme` and returned to the owner in lowercase. */
export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * Saved task-list order. This is the list vocabulary (`manual`, not `MANUAL`).
 * A leading `-` reverses one request and is not part of the saved value.
 */
export type DefaultTaskSort = 'manual' | 'priority' | 'dueDate' | 'scheduledStart' | 'createdAt';

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
  /** Forward order. Missing preference rows are returned as `manual`. */
  defaultTaskSort: DefaultTaskSort;
  createdAt: string;
}
