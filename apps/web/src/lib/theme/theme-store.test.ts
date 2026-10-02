import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyAuthoritativeTheme,
  readThemePreference,
  resetThemeUserAdjustment,
  resolveTheme,
  setThemePreference,
  subscribeToThemePreference,
  THEME_STORAGE_KEY,
} from './theme-store';

describe('resolveTheme', () => {
  it('follows the system only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('theme preference persistence', () => {
  beforeEach(() => {
    resetThemeUserAdjustment();
    window.localStorage.clear();
  });

  it('defaults to system and ignores unknown stored values', () => {
    expect(readThemePreference()).toBe('system');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readThemePreference()).toBe('system');
  });

  it('persists the preference and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToThemePreference(listener);

    setThemePreference('dark');

    expect(readThemePreference()).toBe('dark');
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('applies the saved theme until the person picks one on this page', () => {
    applyAuthoritativeTheme('dark');
    expect(readThemePreference()).toBe('dark');

    setThemePreference('light');
    applyAuthoritativeTheme('dark');
    expect(readThemePreference()).toBe('light');
  });
});
