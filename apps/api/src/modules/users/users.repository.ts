import { Injectable } from '@nestjs/common';
import type { CurrentUser, DefaultTaskSort, ThemePreference } from '@planit/types';

import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  preferenceFromSortField,
  preferenceToSort,
  type StoredTaskSort,
} from '../tasks/task-query.js';

const THEME_TO_DB = {
  light: 'LIGHT',
  dark: 'DARK',
  system: 'SYSTEM',
} as const satisfies Record<ThemePreference, 'LIGHT' | 'DARK' | 'SYSTEM'>;

const THEME_FROM_DB = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
} as const satisfies Record<'LIGHT' | 'DARK' | 'SYSTEM', ThemePreference>;

const CURRENT_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  timezone: true,
  emailVerifiedAt: true,
  createdAt: true,
  preference: { select: { theme: true, defaultTaskSort: true } },
} as const;

interface CurrentUserRow {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  preference: { theme: keyof typeof THEME_FROM_DB; defaultTaskSort: StoredTaskSort } | null;
}

function toCurrentUser(row: CurrentUserRow): CurrentUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    timezone: row.timezone,
    emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
    theme: THEME_FROM_DB[row.preference?.theme ?? 'SYSTEM'],
    defaultTaskSort: preferenceToSort(row.preference?.defaultTaskSort ?? 'MANUAL').field,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(userId: string): Promise<CurrentUser | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: CURRENT_USER_SELECT,
    });
    return row ? toCurrentUser(row) : null;
  }

  async updateProfile(
    userId: string,
    input: { displayName?: string | null; timezone?: string },
  ): Promise<CurrentUser | null> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) return null;
    const row = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      },
      select: CURRENT_USER_SELECT,
    });
    return toCurrentUser(row);
  }

  async updateTheme(userId: string, theme: ThemePreference): Promise<CurrentUser | null> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) return null;
    await this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId, theme: THEME_TO_DB[theme] },
      update: { theme: THEME_TO_DB[theme] },
    });
    return this.findById(userId);
  }

  async updateTaskSort(userId: string, sort: DefaultTaskSort): Promise<CurrentUser | null> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) return null;
    const defaultTaskSort = preferenceFromSortField(sort);
    await this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId, defaultTaskSort },
      update: { defaultTaskSort },
    });
    return this.findById(userId);
  }
}
