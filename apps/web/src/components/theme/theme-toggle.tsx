'use client';

import { Button } from '@planit/ui/components/button';

import { THEME_OPTIONS } from '@/components/theme/theme-options';
import { useTheme } from '@/lib/theme/use-theme';

/** Compact control that cycles Light → Dark → System. The full selector lives in Settings. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const currentIndex = THEME_OPTIONS.findIndex((option) => option.value === preference);
  const current = THEME_OPTIONS[currentIndex] ?? THEME_OPTIONS[0]!;
  const next = THEME_OPTIONS[(currentIndex + 1) % THEME_OPTIONS.length]!;
  const Icon = current.icon;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setPreference(next.value)}
      aria-label={`Theme: ${current.label}. Switch to ${next.label}.`}
      title={`Theme: ${current.label}`}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
