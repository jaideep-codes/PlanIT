'use client';

import { useSyncExternalStore } from 'react';

import {
  readSystemPrefersDark,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeToSystemTheme,
  subscribeToThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from './theme-store';

const serverPreference = (): ThemePreference => 'system';
const serverPrefersDark = () => false;

export interface UseThemeResult {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

export function useTheme(): UseThemeResult {
  const preference = useSyncExternalStore(
    subscribeToThemePreference,
    readThemePreference,
    serverPreference,
  );
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    readSystemPrefersDark,
    serverPrefersDark,
  );

  return {
    preference,
    resolvedTheme: resolveTheme(preference, systemPrefersDark),
    setPreference: setThemePreference,
  };
}
