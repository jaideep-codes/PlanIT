import { Badge } from '@planit/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@planit/ui/components/card';
import { CircleDashed, type LucideIcon } from 'lucide-react';

interface UpcomingFeatureProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** What this area will contain once built. Shown as plain text, never as fake data. */
  planned: readonly string[];
}

/**
 * Honest empty state for sections whose functionality has not been built yet. It never shows
 * sample numbers or mock records.
 */
export function UpcomingFeature({ icon: Icon, title, description, planned }: UpcomingFeatureProps) {
  return (
    <Card className="border-dashed">
      <CardHeader className="gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="grid gap-1">
            <CardTitle>{title}</CardTitle>
            <Badge variant="secondary">Not available yet</Badge>
          </div>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Coming here
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {planned.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm">
              <CircleDashed
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              {item}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
