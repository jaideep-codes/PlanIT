import {
  CalendarDays,
  ChartColumn,
  House,
  Settings,
  Trophy,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';

export interface NavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom tab bar (limited space); the rest are reachable from the header. */
  inMobileTabBar: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Home', icon: House, inMobileTabBar: true },
  { href: '/statistics', label: 'Statistics', icon: ChartColumn, inMobileTabBar: true },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays, inMobileTabBar: true },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy, inMobileTabBar: true },
  { href: '/profile', label: 'Profile', icon: UserRound, inMobileTabBar: true },
  { href: '/settings', label: 'Settings', icon: Settings, inMobileTabBar: false },
];

export const ASK_PLANIT_HREF: Route = '/ask';

export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
