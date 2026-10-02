'use client';

import { authAcknowledgementSchema } from '@planit/shared';
import { Button } from '@planit/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@planit/ui/components/card';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiError, apiPost } from '@/lib/api/api-client';

export function LogoutForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onLogout() {
    setFormError(null);
    setPending(true);
    try {
      await apiPost('/v1/auth/logout', {}, authAcknowledgementSchema);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        setFormError(error instanceof ApiError ? error.message : 'Could not log out.');
        setPending(false);
        return;
      }
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log out</CardTitle>
        <CardDescription>This ends the session on this browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onLogout();
          }}
        >
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? 'Logging out…' : 'Log out'}
          </Button>
        </form>
        <Link
          href="/"
          className="mt-4 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Back to PlanIT
        </Link>
      </CardContent>
    </Card>
  );
}
