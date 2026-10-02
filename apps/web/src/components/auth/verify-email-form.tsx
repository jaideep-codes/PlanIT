'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  authAcknowledgementSchema,
  otpResendRequestSchema,
  otpVerifyRequestSchema,
  type OtpVerifyRequest,
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

export function VerifyEmailForm({ initialEmail }: { initialEmail: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<OtpVerifyRequest>({
    resolver: zodResolver(otpVerifyRequestSchema),
    defaultValues: { email: initialEmail, code: '' },
  });

  async function onSubmit(values: OtpVerifyRequest) {
    setFormError(null);
    setNotice(null);
    try {
      await apiPost('/v1/auth/otp/verify', values, authAcknowledgementSchema);
      router.push('/login?verified=1');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not verify the code.');
    }
  }

  async function onResend() {
    setFormError(null);
    setNotice(null);
    const email = getValues('email');
    const parsed = otpResendRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setFormError('Enter the email address you signed up with.');
      return;
    }
    setResending(true);
    try {
      await apiPost('/v1/auth/otp/resend', parsed.data, authAcknowledgementSchema);
      setNotice('If that email is waiting to be verified, a new code is on its way.');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not send a new code.');
    } finally {
      setResending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify your email</CardTitle>
        <CardDescription>
          Enter the 6-digit code from your inbox. It expires in 10 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <AuthField
            id="verify-email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            error={errors.email?.message}
            {...register('email')}
          />
          <AuthField
            id="verify-code"
            label="Verification code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            pattern="\d{6}"
            error={errors.code?.message}
            {...register('code')}
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
            {isSubmitting ? 'Checking code…' : 'Verify email'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onResend}
            disabled={resending || isSubmitting}
          >
            {resending ? 'Sending…' : 'Resend code'}
          </Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          Already verified?{' '}
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
