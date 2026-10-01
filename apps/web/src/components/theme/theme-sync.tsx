'use client';

import { useLayoutEffect } from 'react';

import {
  applyResolvedTheme,
  readSystemPrefersDark,
  readThemePreference,
  resolveTheme,
} from '@/lib/theme/theme-store';
import { useTheme } from '@/lib/theme/use-theme';

/**
 * Keeps the `dark` class on <html> in sync with the stored preference and the OS setting.
 * Reads the live values rather than the rendered snapshot: during hydration the snapshot is
 * the server default, and applying it would briefly flash the wrong theme. Also re-applies
 * after React Strict Mode's development remount resets <html> attributes.
 */
export function ThemeSync() {
  const { resolvedTheme } = useTheme();

  useLayoutEffect(() => {
    applyResolvedTheme(resolveTheme(readThemePreference(), readSystemPrefersDark()));
  }, [resolvedTheme]);

  return null;
}
