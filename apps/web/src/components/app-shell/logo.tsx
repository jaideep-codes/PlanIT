import { cn } from '@planit/ui/lib/cn';

/** PlanIT mark: a progress ring closing around a check — plan, then measure follow-through. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('size-8 shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="16" className="fill-primary" />
      <circle
        cx="32"
        cy="32"
        r="17"
        fill="none"
        strokeWidth="5"
        className="stroke-primary-foreground/35"
      />
      <path
        d="M32 15a17 17 0 0 1 17 17"
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        className="stroke-primary-foreground"
      />
      <path
        d="m24.5 32.5 5 5 10-11"
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary-foreground"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight">PlanIT</span>
    </span>
  );
}
