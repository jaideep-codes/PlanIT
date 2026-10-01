import { Trophy } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { UpcomingFeature } from '@/components/upcoming-feature';

export const metadata: Metadata = { title: 'Leaderboard' };

export default function LeaderboardPage() {
  return (
    <>
      <PageHeader
        title="Leaderboard"
        description="Friendly accountability with friends or everyone — only for people who opt in."
      />
      <UpcomingFeature
        icon={Trophy}
        title="Leaderboards"
        description="Rankings respect each person's privacy and leaderboard visibility settings."
        planned={[
          'Friends and global leaderboards',
          'Daily, weekly, and monthly periods',
          'Separate focus, streak, and task rankings',
          'Top 10, your position, and people near your rank',
        ]}
      />
    </>
  );
}
