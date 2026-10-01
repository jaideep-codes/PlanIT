import { Sparkles } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { UpcomingFeature } from '@/components/upcoming-feature';

export const metadata: Metadata = { title: 'Ask PlanIT' };

export default function AskPlanItPage() {
  return (
    <>
      <PageHeader
        title="Ask PlanIT"
        description="Describe a goal and PlanIT proposes a plan. Nothing changes until you approve it."
      />
      <UpcomingFeature
        icon={Sparkles}
        title="AI planning"
        description="PlanIT AI only proposes changes. You review the exact tasks and schedule before anything is saved."
        planned={[
          'Goal → milestones → tasks',
          'Proposed schedule that fits your availability',
          'Re-planning when you miss sessions',
          'Optional bring-your-own-key mode',
        ]}
      />
    </>
  );
}
