'use client';

import { currentUserSchema } from '@planit/shared';
import { useEffect } from 'react';

import { apiGet } from '@/lib/api/api-client';
import { applyAuthoritativeTheme } from '@/lib/theme/theme-store';

/**
 * Copies the saved theme into the first-paint cache after sign-in. A choice made on this
 * page is left alone if the response arrives later.
 */
export function AccountThemeSync() {
  useEffect(() => {
    let cancelled = false;
    void apiGet('/v1/users/me', currentUserSchema)
      .then((user) => {
        if (!cancelled) applyAuthoritativeTheme(user.theme);
      })
      .catch(() => {
        // Keep the local cache when the account cannot be read.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
