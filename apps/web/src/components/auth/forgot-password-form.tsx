'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  authAcknowledgementSchema,
  passwordForgotRequestSchema,
  type PasswordForgotRequest,
} from '@planit/shared';
import { Button } from '@planit/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@planit/ui/components/card';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { AuthField } from '@/components/auth/auth-field';
import { ApiError, apiPost } from '@/lib/api/api-client';

export function ForgotPasswordForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordForgotRequest>({
    resolver: zodResolver(passwordForgotRequestSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: PasswordForgotRequest) {
    setFormError(null);
    try {
      await apiPost('/v1/auth/password/forgot', values, authAcknowledgementSchema);
      router.push(`/reset-password?email=${encodeURIComponent(values.email)}`);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not request a reset code.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we will send a 6-digit code if an account exists. The code is not a
          link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <AuthField
            id="forgot-email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            error={errors.email?.message}
            {...register('email')}
          />
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? 'Sending code…' : 'Send reset code'}
          </Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          Remembered it?{' '}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
