import type { Metadata } from 'next';

import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; verified?: string; reset?: string }>;
}) {
  const params = await searchParams;
  return (
    <LoginForm
      nextPath={typeof params.next === 'string' ? params.next : undefined}
      verified={params.verified === '1'}
      reset={params.reset === '1'}
    />
  );
}
