'use client';

import { cn } from '@planit/ui/lib/cn';
import { useState } from 'react';

import { THEME_OPTIONS } from '@/components/theme/theme-options';
import { ApiError } from '@/lib/api/api-client';
import { persistThemePreference } from '@/lib/theme/persist-theme';
import { useTheme } from '@/lib/theme/use-theme';
import type { ThemePreference } from '@/lib/theme/theme-store';

/** Native radio inputs give keyboard navigation and screen-reader semantics for free. */
export function ThemeSelector() {
  const { preference } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function select(value: ThemePreference) {
    setError(null);
    setSaving(true);
    try {
      await persistThemePreference(value);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the theme.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="grid gap-3" aria-busy={saving}>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-3">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2 rounded-lg border bg-background px-3 py-4 text-sm font-medium transition-colors',
              'hover:bg-accent/60 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:text-accent-foreground',
              'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
            )}
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={preference === value}
              onChange={() => {
                void select(value);
              }}
              className="sr-only"
            />
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </label>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
