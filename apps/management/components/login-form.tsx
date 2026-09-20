'use client';

import { redirect, useRouter, useSearchParams } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  AUTH_REDIRECT_QUERY_PARAM,
  buildAuthCallbackURL,
  buildSignInRedirectPath,
  sanitizeAuthRedirectPath,
} from '@campuspilot/auth/redirects';
import { Button } from '@campuspilot/ui/components/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@campuspilot/ui/components/field';
import { Input } from '@campuspilot/ui/components/input';
import { BrandLogo } from '@campuspilot/components/brand-logo';
import { SiGoogle } from '@icons-pack/react-simple-icons';
import { ArrowRight } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { AuthLoading } from './auth-loading';

const loginSchema = z
  .object({
    email: z.string(),
    password: z.string(),
    method: z.enum(['credentials', 'google']),
  })
  .superRefine((value, context) => {
    if (value.method !== 'credentials') return;

    const emailResult = z.email('Enter a valid email address.').safeParse(value.email);
    if (!emailResult.success) {
      context.addIssue({
        code: 'custom',
        path: ['email'],
        message: emailResult.error.issues[0]?.message ?? 'Enter a valid email address.',
      });
    }

    if (value.password.length < 8) {
      context.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password must contain at least 8 characters.',
      });
    }
  });

/**
 * The sign-in route is explicit so alternate login presentations return to
 * their own screen when an external provider reports an error.
 */
export function LoginForm({ signInPath = '/auth/login' }: { signInPath?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const redirectPath = sanitizeAuthRedirectPath(
    searchParams.get(AUTH_REDIRECT_QUERY_PARAM),
    '/school',
  );
  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
      method: 'credentials' as 'credentials' | 'google',
    },
    validators: { onSubmit: loginSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});

      if (value.method === 'google') {
        const result = await authClient.signIn.social({
          provider: 'google',
          callbackURL: buildAuthCallbackURL(window.location.origin, redirectPath),
          errorCallbackURL: buildAuthCallbackURL(
            window.location.origin,
            buildSignInRedirectPath(redirectPath, signInPath),
          ),
        });

        if (result.error) {
          form.setErrorMap({
            onSubmit: {
              form: result.error.message ?? 'Unable to continue with Google.',
              fields: {},
            },
          });
        }
        return;
      }

      const result = await authClient.signIn.email({
        email: value.email,
        password: value.password,
      });

      if (result.error) {
        form.setErrorMap({
          onSubmit: {
            form: result.error.message ?? 'Unable to sign in.',
            fields: {},
          },
        });
        return;
      }

      router.replace(redirectPath);
    },
  });

  if (isPending) return <AuthLoading fullScreen={false} />;
  if (session) redirect('/school');

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <BrandLogo />
        <p className="text-sm leading-6 text-muted-foreground">
          Enter your school account details to continue.
        </p>
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.setFieldValue('method', 'credentials');
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.Field name="email">
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={field.name}>Email address</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="email"
                  autoComplete="email"
                  placeholder="you@school.edu"
                  className="h-11 px-3 text-sm md:text-sm"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="password">
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="h-11 px-3 text-sm md:text-sm"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </FieldGroup>

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
            errors: state.errors,
            method: state.values.method,
          })}
        >
          {({ canSubmit, isSubmitting, errors, method }) => (
            <div className="flex flex-col gap-4">
              <FieldError errors={errors} />
              <Button
                type="submit"
                size="lg"
                className="h-11 w-full text-sm"
                disabled={!canSubmit || isSubmitting}
              >
                {isSubmitting && method === 'credentials'
                  ? 'Signing in…'
                  : 'Sign in'}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>

              <FieldSeparator>or</FieldSeparator>

              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 w-full text-sm"
                disabled={isSubmitting}
                onClick={() => {
                  form.setFieldValue('method', 'google');
                  void form.handleSubmit();
                }}
              >
                <SiGoogle className="size-4" aria-hidden="true" />
                {isSubmitting && method === 'google'
                  ? 'Opening Google…'
                  : 'Continue with Google'}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>

      <FieldDescription className="text-center">
        Your account is created by your school. Contact your administrator if
        you need access.
      </FieldDescription>
    </div>
  );
}
