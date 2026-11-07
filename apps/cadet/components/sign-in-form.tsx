'use client';

import { sanitizeAuthRedirectPath, AUTH_REDIRECT_QUERY_PARAM } from '@campuspilot/auth/redirects';
import { CADET_ADMISSION_SIGN_IN_PATH } from '@campuspilot/auth/cadet-policy';
import { Button } from '@campuspilot/ui/components/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@campuspilot/ui/components/field';
import { Input } from '@campuspilot/ui/components/input';
import { useForm } from '@tanstack/react-form';
import { redirect, useSearchParams } from 'next/navigation';
import { z } from 'zod';

import { authClient, isSignedOAuthRequest, oauthAuthClient, oauthRedirectUrl } from '@/lib/auth-client';

const signInSchema = z.object({
  schoolSlug: z.string().trim().min(1, 'Enter your school code.').max(100),
  admissionNo: z.string().trim().min(1, 'Enter your admission number.').max(100),
  password: z.string().min(1, 'Enter your password.').max(128),
});

type SignInValues = z.infer<typeof signInSchema>;

const fields = [
  { name: 'schoolSlug', label: 'School code', type: 'text', autoComplete: 'organization' },
  { name: 'admissionNo', label: 'Admission number', type: 'text', autoComplete: 'username' },
  { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
] as const;

/**
 * Posts the admission sign-in. When an AI app's authorization sent the
 * student here, the OAuth client forwards the signed query and the server
 * answers with the next URL (consent or the app's callback).
 */
function useSignInForm() {
  const searchParams = useSearchParams();
  const oauthRequest = isSignedOAuthRequest(searchParams);
  const redirectPath = sanitizeAuthRedirectPath(searchParams.get(AUTH_REDIRECT_QUERY_PARAM));
  const form = useForm({
    defaultValues: { schoolSlug: '', admissionNo: '', password: '' } satisfies SignInValues,
    validators: { onSubmit: signInSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      const client = oauthRequest ? oauthAuthClient : authClient;
      const result = await client.$fetch(CADET_ADMISSION_SIGN_IN_PATH, {
        method: 'POST',
        body: signInSchema.parse(value),
      });
      if (result.error) {
        form.setErrorMap({ onSubmit: { form: result.error.message ?? 'Unable to sign in.', fields: {} } });
        return;
      }
      const next = oauthRequest ? oauthRedirectUrl(result.data) : null;
      if (next) {
        window.location.assign(next);
        return;
      }
      // A full navigation, because the sign-in went through a custom
      // endpoint that the auth client's cached session does not observe.
      window.location.assign(redirectPath);
    },
  });
  return { form, oauthRequest };
}

export function SignInForm() {
  const { data: session, isPending } = authClient.useSession();
  const { form, oauthRequest } = useSignInForm();
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  // An AI app may ask for a fresh sign-in, so the form stays visible then.
  if (session && !oauthRequest) redirect('/');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Cadet Portal</h1>
        <p className="text-sm text-muted-foreground">Sign in with the details your school gave you.</p>
      </div>
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          {fields.map((item) => (
            <form.Field key={item.name} name={item.name}>
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={field.name}>{item.label}</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type={item.type}
                    autoComplete={item.autoComplete}
                    autoCapitalize="none"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={field.state.meta.errors.length > 0}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          ))}
        </FieldGroup>
        {/*
          Only the server's sign-in error is shown here. Schema errors are
          per field and shown under their inputs; the form-level error state
          also holds that field map, which is not a message.
        */}
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting, submitError: state.errorMap.onSubmit })}>
          {({ canSubmit, isSubmitting, submitError }) => (
            <div className="flex flex-col gap-3">
              {typeof submitError === 'string' ? <p className="text-sm text-destructive">{submitError}</p> : null}
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}
