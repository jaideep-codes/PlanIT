import { describe, expect, it } from 'vitest';

import {
  updateCurrentUserRequestSchema,
  updateTaskSortRequestSchema,
  updateThemeRequestSchema,
} from './user.js';

describe('current user schemas', () => {
  it('accepts a display name and an IANA timezone', () => {
    expect(
      updateCurrentUserRequestSchema.parse({
        displayName: '  Ada  ',
        timezone: 'Asia/Kolkata',
      }),
    ).toEqual({ displayName: 'Ada', timezone: 'Asia/Kolkata' });
  });

  it('turns a blank display name into null and rejects unknown fields', () => {
    expect(updateCurrentUserRequestSchema.parse({ displayName: '   ' })).toEqual({
      displayName: null,
    });
    expect(
      updateCurrentUserRequestSchema.safeParse({
        displayName: 'Ada',
        timezone: 'UTC',
        theme: 'dark',
        passwordHash: 'secret',
        userId: 'someone-else',
      }).success,
    ).toBe(false);
    expect(updateCurrentUserRequestSchema.safeParse({}).success).toBe(false);
    expect(updateCurrentUserRequestSchema.parse({ timezone: 'UTC' })).toEqual({ timezone: 'UTC' });
    expect(updateCurrentUserRequestSchema.safeParse({ timezone: 'utc' }).success).toBe(false);
    expect(updateCurrentUserRequestSchema.safeParse({ timezone: 'Not/AZone' }).success).toBe(false);
  });

  it('accepts only the three theme preferences', () => {
    expect(updateThemeRequestSchema.parse({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(updateThemeRequestSchema.safeParse({ theme: 'neon' }).success).toBe(false);
    expect(updateThemeRequestSchema.safeParse({ theme: 'DARK', userId: 'x' }).success).toBe(false);
    expect(
      updateThemeRequestSchema.safeParse({ theme: 'dark', defaultTaskSort: 'manual' }).success,
    ).toBe(false);
  });

  it('accepts the five list sort fields and rejects direction, profile, and theme', () => {
    expect(updateTaskSortRequestSchema.parse({ defaultTaskSort: 'dueDate' })).toEqual({
      defaultTaskSort: 'dueDate',
    });
    expect(updateTaskSortRequestSchema.safeParse({ defaultTaskSort: 'manual' }).success).toBe(true);
    expect(updateTaskSortRequestSchema.safeParse({ defaultTaskSort: '-priority' }).success).toBe(
      false,
    );
    expect(updateTaskSortRequestSchema.safeParse({ defaultTaskSort: 'MANUAL' }).success).toBe(
      false,
    );
    expect(
      updateTaskSortRequestSchema.safeParse({ defaultTaskSort: 'priority', theme: 'dark' }).success,
    ).toBe(false);
    expect(
      updateCurrentUserRequestSchema.safeParse({
        displayName: 'Ada',
        defaultTaskSort: 'manual',
      }).success,
    ).toBe(false);
  });
});
