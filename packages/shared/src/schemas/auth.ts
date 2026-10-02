import type {
  AuthAcknowledgement,
  AuthSessionList,
  GoogleSignInAvailability,
  SessionRevocation,
} from '@planit/types';
import { z } from 'zod';

const emailSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email('Enter a valid email address.').max(320));

const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(200, 'Password must be at most 200 characters.');

/** Signup composition rules. Login does not repeat them; a mismatch is an invalid-credentials error. */
const signupPasswordSchema = passwordSchema.superRefine((value, ctx) => {
  if (value.length < 10 || value.length > 200) return;
  const missing: string[] = [];
  if (!/\p{Ll}/u.test(value)) missing.push('a lowercase letter');
  if (!/\p{Lu}/u.test(value)) missing.push('an uppercase letter');
  if (!/\p{N}/u.test(value)) missing.push('a number');
  if (!/[^\p{L}\p{N}]/u.test(value)) missing.push('a symbol');
  if (missing.length === 0) return;
  const listed =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  ctx.addIssue({ code: 'custom', message: `Password must include ${listed}.` });
});

export const signupRequestSchema = z.strictObject({
  email: emailSchema,
  password: signupPasswordSchema,
});

const loginPasswordSchema = z.string().max(200, 'Password must be at most 200 characters.');

export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: loginPasswordSchema,
});

export const otpVerifyRequestSchema = z.strictObject({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export const otpResendRequestSchema = z.strictObject({
  email: emailSchema,
});

/** Refresh and logout take no fields; the session comes from cookies. */
export const emptyRequestSchema = z.strictObject({});

export const passwordForgotRequestSchema = z.strictObject({
  email: emailSchema,
});

export const passwordResetRequestSchema = z.strictObject({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  password: signupPasswordSchema,
});

export const sessionIdSchema = z.uuid('Enter a valid session id.');

export const authSessionSummarySchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});

export const authSessionListSchema = z.strictObject({
  items: z.array(authSessionSummarySchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<AuthSessionList>;

export const sessionRevocationSchema = z.strictObject({
  status: z.literal('revoked'),
  currentSessionRevoked: z.boolean(),
}) satisfies z.ZodType<SessionRevocation>;

export const authAcknowledgementSchema = z.strictObject({
  status: z.enum([
    'verification_required',
    'verified',
    'authenticated',
    'logged_out',
    'reset_requested',
    'password_reset',
  ]),
}) satisfies z.ZodType<AuthAcknowledgement>;

export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type OtpVerifyRequest = z.infer<typeof otpVerifyRequestSchema>;
export type OtpResendRequest = z.infer<typeof otpResendRequestSchema>;
export type PasswordForgotRequest = z.infer<typeof passwordForgotRequestSchema>;
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

/**
 * Google's callback query. Unknown keys (scope, authuser) are ignored. The authorization
 * code is read once and never stored.
 */
export const googleCallbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(128).optional(),
  error: z.string().min(1).max(64).optional(),
});

export const googleSignInAvailabilitySchema = z.strictObject({
  available: z.boolean(),
}) satisfies z.ZodType<GoogleSignInAvailability>;
