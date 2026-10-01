/**
 * Theme preference store. Until accounts exist the preference lives in localStorage as a UI
 * cache; from Phase 2 the authoritative value is UserPreference.theme and this store mirrors
 * it so the correct theme is applied before first paint.
 *
 * The same logic is duplicated (by necessity) in THEME_INIT_SCRIPT, which runs before React.
 */

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'planit-theme';
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
const DEFAULT_PREFERENCE: ThemePreference = 'system';

const listeners = new Set<() => void>();

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_PREFERENCE;
  } catch {
    // Storage can be unavailable (privacy modes, blocked cookies).
    return DEFAULT_PREFERENCE;
  }
}

export function readSystemPrefersDark(): boolean {
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Still apply for this page view even if it cannot be persisted.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeToThemePreference(listener: () => void): () => void {
  listeners.add(listener);
  // Keep tabs in sync when the preference changes elsewhere.
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function subscribeToSystemTheme(listener: () => void): () => void {
  const query = window.matchMedia(DARK_SCHEME_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/**
 * Inline script rendered in <head> (with the CSP nonce) so the theme is applied before the
 * first paint, avoiding a light/dark flash.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=p==="dark"||(p!=="light"&&window.matchMedia(${JSON.stringify(
  DARK_SCHEME_QUERY,
)}).matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})();`;
