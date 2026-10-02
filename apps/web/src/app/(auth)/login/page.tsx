import type { Metadata } from 'next';

import { LoginForm } from '@/components/auth/login-form';
import { googleSignInErrorMessage, isGoogleSignInConfigured } from '@/lib/auth/google-sign-in';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; verified?: string; reset?: string; google?: string }>;
}) {
  const params = await searchParams;
  const googleAvailable = await isGoogleSignInConfigured();
  return (
    <LoginForm
      nextPath={typeof params.next === 'string' ? params.next : undefined}
      verified={params.verified === '1'}
      reset={params.reset === '1'}
      googleAvailable={googleAvailable}
      googleMessage={googleSignInErrorMessage(
        typeof params.google === 'string' ? params.google : undefined,
      )}
    />
  );
}
