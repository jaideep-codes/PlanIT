import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@planit/ui/components/card';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { SystemStatus } from '@/components/settings/system-status';
import { ThemeSelector } from '@/components/theme/theme-selector';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Personalize PlanIT." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Choose light or dark, or follow your device&apos;s setting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeSelector />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>System status</CardTitle>
            <CardDescription>Live health of the PlanIT service.</CardDescription>
          </CardHeader>
          <CardContent>
            <SystemStatus />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
