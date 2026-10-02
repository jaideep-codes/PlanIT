import { currentUserSchema } from '@planit/shared';

import { apiPatch } from '@/lib/api/api-client';
import {
  readThemePreference,
  setThemePreference,
  type ThemePreference,
} from '@/lib/theme/theme-store';

/** Writes the first-paint cache immediately, then saves UserPreference.theme. */
export async function persistThemePreference(next: ThemePreference): Promise<void> {
  const previous = readThemePreference();
  if (previous === next) return;
  setThemePreference(next);
  try {
    const saved = await apiPatch('/v1/users/me/theme', { theme: next }, currentUserSchema);
    if (saved.theme !== next) setThemePreference(saved.theme);
  } catch (error) {
    setThemePreference(previous);
    throw error;
  }
}
