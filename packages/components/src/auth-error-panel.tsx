import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { BrandLogo } from './brand-logo';

type AuthErrorCopy = {
  title: string;
  description: string;
};

const AUTH_ERROR_COPY: Record<string, AuthErrorCopy> = {
  account_not_linked: {
    title: 'Google sign-in is not linked',
    description:
      'A CampusPilot user already exists for this email, but Google has not been linked to it. Contact your administrator to finish setting up your access.',
  },
  access_denied: {
    title: 'Sign-in was cancelled',
    description:
      'Google did not grant CampusPilot permission to sign you in. You can return and try again when you are ready.',
  },
  email_does_not_match: {
    title: 'Email addresses do not match',
    description:
      'The Google account email does not match the CampusPilot account you are trying to access.',
  },
  email_not_found: {
    title: 'Google did not share an email',
    description:
      'CampusPilot needs an email address from Google to identify your account. Check your Google account permissions and try again.',
  },
  email_not_verified: {
    title: 'Google email is not verified',
    description:
      'Verify the email address on your Google account before using it to sign in to CampusPilot.',
  },
  account_already_linked_to_different_user: {
    title: 'Google account is already in use',
    description:
      'This Google account is linked to a different CampusPilot user. Contact your administrator if you think this is incorrect.',
  },
  state_mismatch: {
    title: 'Sign-in session expired',
    description:
      'The Google sign-in request is no longer valid. Return to sign in and start a new request.',
  },
  state_not_found: {
    title: 'Sign-in session was not found',
    description:
      'CampusPilot could not recover the Google sign-in request. Return to sign in and start again.',
  },
  invalid_code: {
    title: 'Google sign-in could not be completed',
    description:
      'The authorization response was invalid or expired. Return to sign in and try again.',
  },
  unable_to_get_user_info: {
    title: 'Google account details are unavailable',
    description:
      'CampusPilot could not read the account details required for sign-in. Please try again.',
  },
  unable_to_link_account: {
    title: 'Google account could not be linked',
    description:
      'CampusPilot could not safely link this Google account. Contact your administrator if the problem continues.',
  },
  internal_server_error: {
    title: 'CampusPilot could not complete sign-in',
    description:
      'An unexpected authentication error occurred. Please try again, or contact your administrator if the problem continues.',
  },
};

const DEFAULT_AUTH_ERROR_COPY: AuthErrorCopy = {
  title: 'Unable to sign in',
  description:
    'CampusPilot could not complete the authentication request. Return to sign in and try again.',
};

/**
 * Translate OAuth callback codes into safe, actionable copy. Provider-supplied
 * descriptions are intentionally not rendered because they are untrusted.
 */
export function AuthErrorPanel({
  errorCode,
  retryHref,
}: {
  errorCode: string;
  retryHref: string;
}) {
  const copy = AUTH_ERROR_COPY[errorCode] ?? DEFAULT_AUTH_ERROR_COPY;

  return (
    <div className="flex w-full max-w-md flex-col gap-8">
      <BrandLogo />

      <div className="flex flex-col gap-5">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Authentication error
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {copy.title}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {copy.description}
          </p>
        </div>

        <div className="rounded-lg border bg-muted/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Error code:{' '}
            <code className="font-mono text-foreground">{errorCode}</code>
          </p>
        </div>
      </div>

      <Button asChild size="lg" className="h-11 w-full text-sm">
        <a href={retryHref}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Return to sign in
        </a>
      </Button>
    </div>
  );
}
