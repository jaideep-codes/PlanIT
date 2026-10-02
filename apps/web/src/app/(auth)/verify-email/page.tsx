import type { Metadata } from 'next';

import { VerifyEmailForm } from '@/components/auth/verify-email-form';

export const metadata: Metadata = { title: 'Verify email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  return <VerifyEmailForm initialEmail={typeof params.email === 'string' ? params.email : ''} />;
}
