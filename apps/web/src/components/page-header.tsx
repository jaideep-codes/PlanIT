import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {description !== undefined && (
          <p className="max-w-2xl text-sm text-muted-foreground md:text-base">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
