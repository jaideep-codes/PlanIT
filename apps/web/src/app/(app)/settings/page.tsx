import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@planit/ui/components/card';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { ProfileForm } from '@/components/settings/profile-form';
import { SessionList } from '@/components/settings/session-list';
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
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your display name and the timezone used for your day.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
            <CardDescription>
              Devices that can stay signed in. Signing out leaves the other sessions unchanged.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SessionList />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
