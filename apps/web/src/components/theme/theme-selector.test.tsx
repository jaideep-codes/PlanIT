import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeSelector } from '@/components/theme/theme-selector';
import { ThemeSync } from '@/components/theme/theme-sync';
import { resetThemeUserAdjustment, THEME_STORAGE_KEY } from '@/lib/theme/theme-store';

const savedUser = {
  id: '01999999-9999-7999-8999-999999999999',
  email: 'ada@example.com',
  displayName: null,
  timezone: 'UTC',
  emailVerifiedAt: '2026-10-01T00:00:00.000Z',
  theme: 'dark',
  createdAt: '2026-10-01T00:00:00.000Z',
};

describe('ThemeSelector', () => {
  beforeEach(() => {
    resetThemeUserAdjustment();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetThemeUserAdjustment();
    window.localStorage.clear();
  });

  it('offers light, dark, and system with system selected by default', () => {
    render(<ThemeSelector />);
    expect((screen.getByRole('radio', { name: 'Light' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('persists the choice and applies the dark class', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(savedUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
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
