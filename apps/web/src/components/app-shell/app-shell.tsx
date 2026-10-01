import type { ReactNode } from 'react';

import { MobileHeader } from '@/components/app-shell/mobile-header';
import { MobileTabBar } from '@/components/app-shell/mobile-tab-bar';
import { Sidebar } from '@/components/app-shell/sidebar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main
          id="main"
          className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-10 md:pb-12"
        >
          {children}
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
