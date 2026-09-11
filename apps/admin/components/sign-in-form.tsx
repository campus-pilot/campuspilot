'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  AUTH_REDIRECT_QUERY_PARAM,
  buildAuthCallbackURL,
  buildSignInRedirectPath,
  sanitizeAuthRedirectPath,
} from '@campuspilot/auth/redirects';
import { ThemeToggle } from '@campuspilot/components/theme-toggle';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { authClient } from '@/lib/auth-client';
import { AuthLoading } from './auth-loading';

function FieldErrors({ errors }: { errors: Array<{ message?: string } | undefined> }) {
  return errors.map((error) => error?.message ? (
    <p key={error.message} className="text-xs text-destructive">{error.message}</p>
  ) : null);
}

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const [error, setError] = useState<string>();
  const [isSocialSignInPending, setIsSocialSignInPending] = useState(false);
  const redirectPath = sanitizeAuthRedirectPath(searchParams.get(AUTH_REDIRECT_QUERY_PARAM));
  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: {
      onSubmit: z.object({
        email: z.email('Enter a valid email address.'),
        password: z.string().min(8, 'Password must contain at least 8 characters.'),
      }),
    },
    onSubmit: async ({ value }) => {
      setError(undefined);
      const result = await authClient.signIn.email(value);
      if (result.error) {
        setError(result.error.message ?? 'Unable to sign in.');
        return;
      }
      router.replace(redirectPath);
    },
  });

  useEffect(() => {
    if (isPending || !session) return;
    router.replace(session.user.role === 'admin' ? redirectPath : '/unauthorized');
  }, [isPending, redirectPath, router, session]);

  async function signInWithGoogle() {
    setError(undefined);
    setIsSocialSignInPending(true);
    const result = await authClient.signIn.social({
      provider: 'google',
      callbackURL: buildAuthCallbackURL(window.location.origin, redirectPath),
      errorCallbackURL: buildAuthCallbackURL(window.location.origin, buildSignInRedirectPath(redirectPath)),
    });
    setIsSocialSignInPending(false);
    if (result.error) setError(result.error.message ?? 'Unable to sign in with Google.');
  }

  if (isPending || session) return <AuthLoading />;

  return (
    <main className="relative grid min-h-screen place-items-center bg-muted/40 p-6">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Admin sign in</CardTitle>
          <CardDescription>Sign in with your CampusPilot account to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
            <form.Field name="email">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={field.name}>Email</Label>
                  <Input id={field.name} name={field.name} type="email" autoComplete="email" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="password">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={field.name}>Password</Label>
                  <Input id={field.name} name={field.name} type="password" autoComplete="current-password" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
              {({ canSubmit, isSubmitting }) => (
                <>
                  <Button type="submit" disabled={!canSubmit || isSubmitting || isSocialSignInPending}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
                  <Button type="button" variant="outline" disabled={isSubmitting || isSocialSignInPending} onClick={signInWithGoogle}>Continue with Google</Button>
                </>
              )}
            </form.Subscribe>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
