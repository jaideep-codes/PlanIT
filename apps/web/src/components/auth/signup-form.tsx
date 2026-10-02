'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { signupRequestSchema, authAcknowledgementSchema, type SignupRequest } from '@planit/shared';
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
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { ApiError, apiPost } from '@/lib/api/api-client';

export function SignupForm({ googleAvailable }: { googleAvailable: boolean }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupRequest>({
    resolver: zodResolver(signupRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: SignupRequest) {
    setFormError(null);
    try {
      await apiPost('/v1/auth/signup', values, authAcknowledgementSchema);
      router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not create the account.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Use at least 10 characters, including an uppercase letter, a lowercase letter, a number,
          and a symbol. If this email can be registered, we send a verification code.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GoogleSignInButton available={googleAvailable} />
        <p className="my-4 text-center text-xs text-muted-foreground">or</p>
        <form className="grid gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <AuthField
            id="signup-email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            error={errors.email?.message}
            {...register('email')}
          />
          <AuthField
            id="signup-password"
            label="Password"
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
          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          Already have an account?{' '}
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
