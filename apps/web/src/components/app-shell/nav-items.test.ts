import { describe, expect, it } from 'vitest';

import { isActivePath, NAV_ITEMS } from './nav-items';

describe('isActivePath', () => {
  it('matches Home only at the root', () => {
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/statistics', '/')).toBe(false);
  });

  it('matches a section and its sub-pages but not lookalike prefixes', () => {
    expect(isActivePath('/calendar', '/calendar')).toBe(true);
    expect(isActivePath('/calendar/2026-10-02', '/calendar')).toBe(true);
    expect(isActivePath('/calendars', '/calendar')).toBe(false);
  });
});

describe('NAV_ITEMS', () => {
  it('contains exactly the primary navigation from the product spec', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Home',
      'Statistics',
      'Calendar',
      'Leaderboard',
      'Profile',
      'Settings',
    ]);
  });
});
