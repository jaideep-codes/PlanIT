import { Button } from '@planit/ui/components/button';

export function GoogleSignInButton({ available }: { available: boolean }) {
  if (!available) {
    return (
      <Button type="button" variant="outline" className="w-full" disabled>
        Google sign-in is not configured
      </Button>
    );
  }

  return (
    <Button variant="outline" className="w-full" asChild>
      <a href="/api/v1/auth/google/start">Continue with Google</a>
    </Button>
  );
}
