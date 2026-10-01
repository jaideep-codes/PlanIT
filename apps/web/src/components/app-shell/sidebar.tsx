'use client';

import { Button } from '@planit/ui/components/button';
import { cn } from '@planit/ui/lib/cn';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ASK_PLANIT_HREF, isActivePath, NAV_ITEMS } from '@/components/app-shell/nav-items';
import { Logo } from '@/components/app-shell/logo';
import { ThemeToggle } from '@/components/theme/theme-toggle';

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="PlanIT home" className="rounded-md">
          <Logo />
        </Link>
      </div>

      <div className="px-3 pb-2">
        <Button asChild className="w-full justify-start">
          <Link href={ASK_PLANIT_HREF}>
            <Sparkles aria-hidden="true" />
            Ask PlanIT
          </Link>
        </Button>
      </div>

      <nav aria-label="Primary" className="flex-1 px-3 py-2">
        <ul className="grid gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    active
                      ? 'bg-sidebar-active text-sidebar-active-foreground'
                      : 'hover:bg-accent/60 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex items-center justify-between border-t px-5 py-3">
        <span className="text-xs text-muted-foreground">Appearance</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
