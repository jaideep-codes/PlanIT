import { UserRound } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { UpcomingFeature } from '@/components/upcoming-feature';

export const metadata: Metadata = { title: 'Profile' };

export default function ProfilePage() {
  return (
    <>
      <PageHeader
        title="Profile"
        description="Choose exactly what other people can see about you, field by field."
      />
      <UpcomingFeature
        icon={UserRound}
        title="Profile and privacy"
        description="Profiles are assembled on the server from the fields you explicitly allow."
        planned={[
          'Avatar, username, display name, and bio',
          'Field-level visibility: private, friends, or public',
          'Preview exactly what others see',
          'Friends, requests, and blocking',
        ]}
      />
    </>
  );
}
