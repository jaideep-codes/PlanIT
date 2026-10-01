import { CalendarDays } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { UpcomingFeature } from '@/components/upcoming-feature';

export const metadata: Metadata = { title: 'Calendar' };

export default function CalendarPage() {
  return (
    <>
      <PageHeader
        title="Calendar"
        description="Your PlanIT calendar: scheduled work alongside the focus you actually logged."
      />
      <UpcomingFeature
        icon={CalendarDays}
        title="Internal PlanIT calendar"
        description="The calendar is built from your scheduled tasks and focus history inside PlanIT."
        planned={[
          'Daily and weekly views, monthly where useful',
          'Scheduled and completed tasks',
          'Recurring task occurrences',
          'Focus sessions and daily focus totals',
        ]}
      />
    </>
  );
}
