'use client';

import { sanitizeAuthRedirectPath, AUTH_REDIRECT_QUERY_PARAM } from '@campuspilot/auth/redirects';
import { CADET_ADMISSION_SIGN_IN_PATH, CADET_OAUTH_LOGIN_PATH } from '@campuspilot/auth/cadet-policy';
import { Button } from '@campuspilot/ui/components/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@campuspilot/ui/components/field';
import { Input } from '@campuspilot/ui/components/input';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { redirect, useSearchParams } from 'next/navigation';
import { z } from 'zod';

import { authClient, isOAuthRequestExpired, isSignedOAuthRequest, oauthAuthClient, oauthRedirectUrl } from '@/lib/auth-client';

const signInSchema = z.object({
  schoolSlug: z.string().trim().min(1, 'Enter your school code.').max(100),
  admissionNo: z.string().trim().min(1, 'Enter your admission number.').max(100),
  password: z.string().min(1, 'Enter your password.').max(128),
});

type SignInValues = z.infer<typeof signInSchema>;

const OAUTH_REQUEST_EXPIRED_MESSAGE = 'This connection request has expired. Go back to the app and connect again.';

const fields = [
  { name: 'schoolSlug', label: 'School code', type: 'text', autoComplete: 'organization' },
  { name: 'admissionNo', label: 'Admission number', type: 'text', autoComplete: 'username' },
  { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
] as const;

/**
 * Posts the admission sign-in. When an AI app's authorization sent the
 * student here, the OAuth client forwards the signed query and the server
 * answers with the next URL (consent or the app's callback).
 *
 * The request is a mutation rather than a form error: a rejected sign-in is
 * not a field validation error, and storing it in the form's error map would
 * make `canSubmit` false until a field changed, so the student could not
 * simply try again. The form only validates; the mutation owns the outcome.
 *
 * `oauthExpired` is derived from the signed query's `exp` on every render,
 * and checked again before and after the request: an expired authorization
 * is refused by the server with a generic error, so the student is told to
 * restart from the app instead.
 */
function useSignInForm() {
  const searchParams = useSearchParams();
  const oauthRequest = isSignedOAuthRequest(searchParams);
  const redirectPath = sanitizeAuthRedirectPath(searchParams.get(AUTH_REDIRECT_QUERY_PARAM));
  const signIn = useMutation({
    mutationFn: async (values: SignInValues) => {
      const expired = () => oauthRequest && isOAuthRequestExpired(searchParams, Date.now());
      if (expired()) throw new Error(OAUTH_REQUEST_EXPIRED_MESSAGE);
      const client = oauthRequest ? oauthAuthClient : authClient;
      const result = await client.$fetch(CADET_ADMISSION_SIGN_IN_PATH, { method: 'POST', body: values });
      if (result.error) throw new Error(expired() ? OAUTH_REQUEST_EXPIRED_MESSAGE : (result.error.message ?? 'Unable to sign in.'));
      return result.data;
    },
    onSuccess: (data) => {
      // A full navigation, because the sign-in went through a custom
      // endpoint that the auth client's cached session does not observe.
      window.location.assign((oauthRequest ? oauthRedirectUrl(data) : null) ?? redirectPath);
    },
  });
  const form = useForm({
    defaultValues: { schoolSlug: '', admissionNo: '', password: '' } satisfies SignInValues,
    validators: { onSubmit: signInSchema },
    onSubmit: async ({ value }) => {
      // Failures surface through `signIn.error`.
      await signIn.mutateAsync(signInSchema.parse(value)).catch(() => undefined);
    },
  });
  const oauthExpired = oauthRequest && isOAuthRequestExpired(searchParams, Date.now());
  return { form, signIn, oauthRequest, oauthExpired };
}

/**
 * When an AI app's authorization opened the page (the signed OAuth query is
 * in the URL), says so, so the student knows why they are signing in. The
 * app's name is not shown: it is only looked up for a signed-in student, on
 * the consent screen that follows.
 */
function SignInHeading({ oauthRequest }: { oauthRequest: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Cadet Portal</h1>
      <p className="text-sm text-muted-foreground">Sign in with the details your school gave you.</p>
      {oauthRequest ? (
        <p className="text-sm text-muted-foreground">An app is asking to connect to your Cadet Portal. Sign in to continue.</p>
      ) : null}
    </div>
  );
}

/**
 * Shown instead of the form when the app's signed request has expired:
 * signing in with it can only fail. Signing in to the portal itself is
 * offered without the expired query.
 */
function ExpiredOAuthRequest() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Cadet Portal</h1>
      <p className="text-sm text-destructive">{OAUTH_REQUEST_EXPIRED_MESSAGE}</p>
      <Button asChild variant="outline" className="self-start">
        <Link href={CADET_OAUTH_LOGIN_PATH}>Sign in to the Cadet Portal instead</Link>
      </Button>
    </div>
  );
}

export function SignInForm() {
  const { data: session, isPending } = authClient.useSession();
  const { form, signIn, oauthRequest, oauthExpired } = useSignInForm();
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (oauthExpired) return <ExpiredOAuthRequest />;
  // An AI app may ask for a fresh sign-in, so the form stays visible then.
  if (session && !oauthRequest) redirect('/');

  return (
    <div className="flex flex-col gap-6">
      <SignInHeading oauthRequest={oauthRequest} />
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
        {/* Schema errors are per field and shown under their inputs. */}
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <div className="flex flex-col gap-3">
              {signIn.error ? <p className="text-sm text-destructive">{signIn.error.message}</p> : null}
              {/* After success the browser is already leaving, so it stays disabled. */}
              <Button type="submit" disabled={!canSubmit || isSubmitting || signIn.isSuccess}>
                {isSubmitting || signIn.isSuccess ? 'Signing in…' : 'Sign in'}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}
