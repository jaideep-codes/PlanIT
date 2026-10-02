/** Status returned by the credential endpoints. Tokens are delivered only as cookies. */
export const AUTH_STATUSES = [
  'verification_required',
  'verified',
  'authenticated',
  'logged_out',
  'reset_requested',
  'password_reset',
] as const;

export type AuthStatus = (typeof AUTH_STATUSES)[number];

export interface AuthAcknowledgement {
  status: AuthStatus;
}

/** One live refresh session. The token and its hash are never included. */
export interface AuthSessionSummary {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
}

export interface AuthSessionList {
  items: AuthSessionSummary[];
  nextCursor: string | null;
}

export interface SessionRevocation {
  status: 'revoked';
  currentSessionRevoked: boolean;
}

/** Whether the API has Google credentials. This is not a login result. */
export interface GoogleSignInAvailability {
  available: boolean;
}
