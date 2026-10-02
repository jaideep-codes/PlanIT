import { Input } from '@planit/ui/components/input';
import { Label } from '@planit/ui/components/label';
import type { ComponentProps } from 'react';

export function AuthField({
  id,
  label,
  error,
  ...input
}: { id: string; label: string; error?: string } & ComponentProps<'input'>) {
  const errorId = `${id}-error`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...input}
      />
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
