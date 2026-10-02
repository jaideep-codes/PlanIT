import { Button } from '@planit/ui/components/button';
import { LogOut, Settings, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { Logo } from '@/components/app-shell/logo';
import { ASK_PLANIT_HREF } from '@/components/app-shell/nav-items';
import { ThemeToggle } from '@/components/theme/theme-toggle';

export function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/85 px-4 backdrop-blur md:hidden">
      <Link href="/" aria-label="PlanIT home" className="rounded-md">
        <Logo />
      </Link>
      <div className="flex items-center gap-1">
        <Button asChild size="sm">
          <Link href={ASK_PLANIT_HREF}>
            <Sparkles aria-hidden="true" />
            Ask PlanIT
          </Link>
        </Button>
        <ThemeToggle />
        <Button asChild variant="ghost" size="icon">
          <Link href="/logout" aria-label="Log out">
            <LogOut aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="icon">
          <Link href="/settings" aria-label="Settings">
            <Settings aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </header>
  );
}
