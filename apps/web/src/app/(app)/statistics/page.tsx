import { ChartColumn } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { UpcomingFeature } from '@/components/upcoming-feature';

export const metadata: Metadata = { title: 'Statistics' };

export default function StatisticsPage() {
  return (
    <>
      <PageHeader
        title="Statistics"
        description="How much you focused, when, and on what — computed from your real focus sessions."
      />
      <UpcomingFeature
        icon={ChartColumn}
        title="Productivity analytics"
        description="Statistics are derived from recorded focus sessions, so they appear once the focus engine exists."
        planned={[
          'Daily, weekly, monthly, and all-time views',
          'Streaks and personal records',
          'Productivity heatmap',
          'Focus time by skill and priority',
        ]}
      />
    </>
  );
}
