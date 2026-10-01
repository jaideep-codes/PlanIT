'use client';

import { Button } from '@planit/ui/components/button';

/**
 * Route-level error boundary. Only the opaque digest is shown — never the error message,
 * which could contain internal details. The digest correlates with server logs.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        An unexpected error occurred. You can try again; if it keeps happening, please contact
        support.
      </p>
      {error.digest !== undefined && (
        <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      )}
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
