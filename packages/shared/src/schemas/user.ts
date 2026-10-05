import type { CurrentUser, ThemePreference } from '@planit/types';
import { z } from 'zod';

import { TASK_SORT_FIELDS } from './task.js';

export const THEME_PREFERENCES = [
  'light',
  'dark',
  'system',
] as const satisfies readonly ThemePreference[];

export const themePreferenceSchema = z.enum(THEME_PREFERENCES);

/**
 * `Intl.supportedValuesOf('timeZone')` omits `UTC` and some canonical names (for example
 * `Asia/Kolkata`) on Windows ICU. `DateTimeFormat` accepts those names, which is what the
 * server will use for day boundaries.
 */
const TIME_ZONE_NAME = /^(?:UTC|[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/;

function isIanaTimeZone(value: string): boolean {
  if (!TIME_ZONE_NAME.test(value)) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .trim()
  .min(1, 'Enter a timezone.')
  .max(64, 'Enter a timezone.')
  .refine(isIanaTimeZone, 'Enter an IANA timezone, such as Asia/Kolkata.');

const displayNameSchema = z
  .string()
  .trim()
  .max(50, 'Display name must be at most 50 characters.')
  .transform((value) => (value.length === 0 ? null : value));

/** Profile basics only. Theme, email, and credentials are not accepted here. */
export const updateCurrentUserRequestSchema = z
  .strictObject({
    displayName: displayNameSchema.nullable().optional(),
    timezone: timezoneSchema.optional(),
  })
  .refine((value) => value.displayName !== undefined || value.timezone !== undefined, {
    message: 'Provide a display name or a timezone.',
  });

export const updateThemeRequestSchema = z.strictObject({
  theme: themePreferenceSchema,
});

/** List vocabulary only. Direction is chosen per request and is not saved. */
export const updateTaskSortRequestSchema = z.strictObject({
  defaultTaskSort: z.enum(TASK_SORT_FIELDS),
});

export const currentUserSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().nullable(),
  timezone: z.string(),
  emailVerifiedAt: z.iso.datetime().nullable(),
  theme: themePreferenceSchema,
  defaultTaskSort: z.enum(TASK_SORT_FIELDS),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<CurrentUser>;

export type UpdateCurrentUserRequest = z.infer<typeof updateCurrentUserRequestSchema>;
export type UpdateThemeRequest = z.infer<typeof updateThemeRequestSchema>;
export type UpdateTaskSortRequest = z.infer<typeof updateTaskSortRequestSchema>;
