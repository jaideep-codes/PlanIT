import { House } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { TaskList } from '@/components/tasks/task-list';
import { UpcomingFeature } from '@/components/upcoming-feature';

export default function HomePage() {
  return (
    <>
      <PageHeader
        title="Today"
        description="Your plan for the day, what you have focused on, and what is left."
      />
      <div className="grid gap-8">
        <TaskList />
        <UpcomingFeature
          icon={House}
          title="Daily dashboard"
          description="Progress and the focus timer are not available yet."
          planned={[
            "Today's progress and focus time",
            'High, medium, and low priority progress',
            'Current focus session with pause and finish',
          ]}
        />
      </div>
    </>
  );
}
