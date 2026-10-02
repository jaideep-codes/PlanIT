import type { Metadata } from 'next';

import { LogoutForm } from '@/components/auth/logout-form';

export const metadata: Metadata = { title: 'Log out' };

export default function LogoutPage() {
  return <LogoutForm />;
}
