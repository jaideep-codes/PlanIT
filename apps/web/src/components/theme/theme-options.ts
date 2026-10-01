import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import type { ThemePreference } from '@/lib/theme/theme-store';

export interface ThemeOption {
  value: ThemePreference;
  label: string;
  icon: LucideIcon;
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];
