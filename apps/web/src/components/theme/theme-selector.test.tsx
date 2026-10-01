import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ThemeSelector } from '@/components/theme/theme-selector';
import { ThemeSync } from '@/components/theme/theme-sync';
import { THEME_STORAGE_KEY } from '@/lib/theme/theme-store';

describe('ThemeSelector', () => {
  it('offers light, dark, and system with system selected by default', () => {
    render(<ThemeSelector />);
    expect((screen.getByRole('radio', { name: 'Light' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('persists the choice and applies the dark class', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ThemeSync />
        <ThemeSelector />
      </>,
    );

    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect((screen.getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
