import type { Metadata } from 'next';

import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  return <ResetPasswordForm initialEmail={typeof params.email === 'string' ? params.email : ''} />;
}
