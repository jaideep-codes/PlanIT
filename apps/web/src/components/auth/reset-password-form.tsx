'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  authAcknowledgementSchema,
  passwordForgotRequestSchema,
  passwordResetRequestSchema,
  type PasswordResetRequest,
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

export function ResetPasswordForm({ initialEmail }: { initialEmail: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    'If an account exists for that email, a reset code is on its way. It expires in 10 minutes.',
  );
  const [resending, setResending] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetRequest>({
    resolver: zodResolver(passwordResetRequestSchema),
    defaultValues: { email: initialEmail, code: '', password: '' },
  });

  async function onSubmit(values: PasswordResetRequest) {
    setFormError(null);
    setNotice(null);
    try {
      await apiPost('/v1/auth/password/reset', values, authAcknowledgementSchema);
      router.push('/login?reset=1');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not reset the password.');
    }
  }

  async function onResend() {
    setFormError(null);
    setNotice(null);
    const parsed = passwordForgotRequestSchema.safeParse({ email: getValues('email') });
    if (!parsed.success) {
      setFormError('Enter the email address for the account.');
      return;
    }
    setResending(true);
    try {
      await apiPost('/v1/auth/password/forgot', parsed.data, authAcknowledgementSchema);
      setNotice('If an account exists for that email, a new code is on its way.');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not send a new code.');
    } finally {
      setResending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>
          Enter the 6-digit code from your inbox. Use at least 10 characters, including an uppercase
          letter, a lowercase letter, a number, and a symbol.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <AuthField
            id="reset-email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            error={errors.email?.message}
            {...register('email')}
          />
          <AuthField
            id="reset-code"
            label="Reset code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            pattern="\d{6}"
            error={errors.code?.message}
            {...register('code')}
          />
          <AuthField
            id="reset-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            error={errors.password?.message}
            {...register('password')}
          />
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
          <Button type="submit" disabled={isSubmitting || resending} aria-busy={isSubmitting}>
            {isSubmitting ? 'Updating password…' : 'Update password'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void onResend();
            }}
            disabled={resending || isSubmitting}
          >
            {resending ? 'Sending…' : 'Resend code'}
          </Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Back to log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
