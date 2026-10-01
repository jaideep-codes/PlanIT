'use client';

import { cn } from '@planit/ui/lib/cn';

import { THEME_OPTIONS } from '@/components/theme/theme-options';
import { useTheme } from '@/lib/theme/use-theme';

/** Native radio inputs give keyboard navigation and screen-reader semantics for free. */
export function ThemeSelector() {
  const { preference, setPreference } = useTheme();

  return (
    <fieldset className="grid gap-3">
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
              onChange={() => setPreference(value)}
              className="sr-only"
            />
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
