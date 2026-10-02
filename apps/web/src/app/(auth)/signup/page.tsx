import type { Metadata } from 'next';

import { SignupForm } from '@/components/auth/signup-form';
import { isGoogleSignInConfigured } from '@/lib/auth/google-sign-in';

export const metadata: Metadata = { title: 'Sign up' };

export default async function SignupPage() {
  const googleAvailable = await isGoogleSignInConfigured();
  return <SignupForm googleAvailable={googleAvailable} />;
}
