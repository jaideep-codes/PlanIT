'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { authAcknowledgementSchema, loginRequestSchema, type LoginRequest } from '@planit/shared';
import { Button } from '@planit/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@planit/ui/components/card';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { AuthField } from '@/components/auth/auth-field';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { ApiError, apiPost } from '@/lib/api/api-client';

const APP_PATHS = [
  '/',
  '/statistics',
  '/calendar',
  '/leaderboard',
  '/profile',
  '/settings',
  '/ask',
];

function safeNextPath(value: string | undefined): Route {
  if (value && APP_PATHS.includes(value)) return value as Route;
  return '/';
}

export function LoginForm({
  nextPath,
  verified,
  reset,
  googleAvailable,
  googleMessage,
}: {
  nextPath?: string;
  verified: boolean;
  reset: boolean;
  googleAvailable: boolean;
  googleMessage: string | null;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginRequest) {
    setFormError(null);
    try {
      await apiPost('/v1/auth/login', values, authAcknowledgementSchema);
      router.push(safeNextPath(nextPath));
      router.refresh();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not log in.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log in</CardTitle>
        <CardDescription>Use the email and password for your PlanIT account.</CardDescription>
      </CardHeader>
      <CardContent>
        {verified ? (
          <p role="status" className="mb-4 text-sm text-muted-foreground">
            Email verified. You can log in.
          </p>
        ) : null}
        {reset ? (
          <p role="status" className="mb-4 text-sm text-muted-foreground">
            Password updated. Sign in with the new password.
          </p>
        ) : null}
        {googleMessage ? (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {googleMessage}
          </p>
        ) : null}
        <GoogleSignInButton available={googleAvailable} />
        <p className="my-4 text-center text-xs text-muted-foreground">or</p>
        <form className="grid gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <AuthField
            id="login-email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            error={errors.email?.message}
            {...register('email')}
          />
          <AuthField
            id="login-password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            error={errors.password?.message}
            {...register('password')}
          />
          <p className="text-sm">
            <Link
              href="/forgot-password"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Forgot your password?
            </Link>
          </p>
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          New to PlanIT?{' '}
          <Link
            href="/signup"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
