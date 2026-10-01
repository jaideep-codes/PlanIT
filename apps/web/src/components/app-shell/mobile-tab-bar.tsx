'use client';

import { cn } from '@planit/ui/lib/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { isActivePath, NAV_ITEMS } from '@/components/app-shell/nav-items';

const TAB_ITEMS = NAV_ITEMS.filter((item) => item.inMobileTabBar);

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {TAB_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors outline-none focus-visible:bg-accent',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
