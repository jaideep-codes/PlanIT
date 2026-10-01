import { Button } from '@planit/ui/components/button';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you are looking for does not exist or has moved.
      </p>
      <Button asChild>
        <Link href="/">Back to Home</Link>
      </Button>
    </main>
  );
}
