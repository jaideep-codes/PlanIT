/** Access token lifetime. The JWT `exp` claim and the access cookie share this value. */
export const ACCESS_TTL_SECONDS = 15 * 60;

/** Refresh token lifetime. Rotation issues a new token with a fresh window. See decision D-024. */
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_PER_HOUR = 5;
export const OTP_HOUR_MS = 60 * 60 * 1000;
export const USER_AGENT_MAX_LENGTH = 256;

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';
export const VERIFY_EMAIL_MESSAGE = 'Verify your email before signing in.';
export const INVALID_CODE_MESSAGE = 'Invalid or expired code.';
export const OTP_ATTEMPTS_MESSAGE = 'Too many attempts. Request a new code.';
export const RESEND_COOLDOWN_MESSAGE = 'Wait a moment before requesting another code.';
export const RESEND_HOURLY_MESSAGE = 'Too many codes were requested. Try again later.';
export const SESSION_ENDED_MESSAGE = 'Your session has ended. Sign in again.';
export const AUTH_UNAVAILABLE_MESSAGE =
  'Authentication is temporarily unavailable. Try again shortly.';

export const AUDIT_ACTIONS = {
  SIGNUP: 'auth.signup',
  LOGIN_SUCCEEDED: 'auth.login_succeeded',
  LOGIN_FAILED: 'auth.login_failed',
  LOGOUT: 'auth.logout',
  REFRESH_REUSE: 'auth.refresh_reuse',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  PASSWORD_RESET: 'auth.password_reset',
  SESSION_REVOKED: 'auth.session_revoked',
  SESSIONS_REVOKED: 'auth.sessions_revoked',
} as const;

interface Bucket {
  limit: number;
  windowSeconds: number;
}

export interface AuthLimit {
  ip: Bucket;
  email?: Bucket;
  account?: Bucket;
}

/**
 * Named limits on top of the global per-IP throttler. Email and account buckets do not
 * depend on the client IP (TRUST_PROXY stays false). OTP verify stays above the 5-attempt
 * code limit so the code's own counter is what locks a guesser out.
 */
export const AUTH_RATE_LIMITS = {
  signup: {
    email: { limit: 5, windowSeconds: 60 * 60 },
    ip: { limit: 20, windowSeconds: 60 * 60 },
  },
  login: {
    email: { limit: 10, windowSeconds: 15 * 60 },
    ip: { limit: 30, windowSeconds: 15 * 60 },
  },
  otpVerify: {
    email: { limit: 20, windowSeconds: 15 * 60 },
    ip: { limit: 40, windowSeconds: 15 * 60 },
  },
  otpResend: {
    email: { limit: 5, windowSeconds: 60 * 60 },
    ip: { limit: 20, windowSeconds: 60 * 60 },
  },
  refresh: {
    account: { limit: 30, windowSeconds: 60 },
    ip: { limit: 60, windowSeconds: 60 },
  },
  logout: {
    account: { limit: 30, windowSeconds: 60 },
    ip: { limit: 60, windowSeconds: 60 },
  },
  /** One reset email per minute. Checked before account lookup so unknown emails match. */
  passwordForgotCooldown: {
    email: { limit: 1, windowSeconds: 60 },
    ip: { limit: 10, windowSeconds: 60 },
  },
  passwordForgot: {
    email: { limit: 5, windowSeconds: 60 * 60 },
    ip: { limit: 20, windowSeconds: 60 * 60 },
  },
  passwordReset: {
    email: { limit: 20, windowSeconds: 15 * 60 },
    ip: { limit: 40, windowSeconds: 15 * 60 },
  },
} as const satisfies Record<string, AuthLimit>;

export type AuthLimitName = keyof typeof AUTH_RATE_LIMITS;
