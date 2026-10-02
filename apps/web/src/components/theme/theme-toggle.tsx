'use client';

import { Button } from '@planit/ui/components/button';
import { useState } from 'react';

import { THEME_OPTIONS } from '@/components/theme/theme-options';
import { ApiError } from '@/lib/api/api-client';
import { persistThemePreference } from '@/lib/theme/persist-theme';
import { useTheme } from '@/lib/theme/use-theme';

/** Compact control that cycles Light → Dark → System. The full selector lives in Settings. */
export function ThemeToggle() {
  const { preference } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const currentIndex = THEME_OPTIONS.findIndex((option) => option.value === preference);
  const current = THEME_OPTIONS[currentIndex] ?? THEME_OPTIONS[0]!;
  const next = THEME_OPTIONS[(currentIndex + 1) % THEME_OPTIONS.length]!;
  const Icon = current.icon;

  return (
    <span className="inline-flex">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setError(null);
          void persistThemePreference(next.value).catch((caught: unknown) => {
            setError(caught instanceof ApiError ? caught.message : 'Could not save the theme.');
          });
        }}
        aria-label={`Theme: ${current.label}. Switch to ${next.label}.`}
        title={`Theme: ${current.label}`}
      >
        <Icon aria-hidden="true" />
      </Button>
      {error ? (
        <span role="alert" className="sr-only">
          {error}
        </span>
      ) : null}
    </span>
  );
}
