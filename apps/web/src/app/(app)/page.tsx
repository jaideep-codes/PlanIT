import { House } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { UpcomingFeature } from '@/components/upcoming-feature';

export default function HomePage() {
  return (
    <>
      <PageHeader
        title="Today"
        description="Your plan for the day, what you have focused on, and what is left."
      />
      <UpcomingFeature
        icon={House}
        title="Daily dashboard"
        description="The dashboard fills in once accounts, tasks, and focus sessions are available."
        planned={[
          "Today's progress and focus time",
          'High, medium, and low priority progress',
          'Current focus session with pause and finish',
          "Today's tasks with sorting, filtering, and quick add",
        ]}
      />
    </>
  );
}
