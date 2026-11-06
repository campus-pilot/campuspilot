'use client';

import {
  MCP_WRITE_SCOPE,
  OAUTH_LOGIN_PATH,
} from '@campuspilot/auth/mcp-oauth-policy';
import { BrandLogo } from '@campuspilot/components/brand-logo';
import { Button } from '@campuspilot/ui/components/button';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
import { Label } from '@campuspilot/ui/components/label';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BadgeCheck, LoaderCircle, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';

import { authClient } from '@/lib/auth-client';
import {
  isSignedOAuthRequest,
  oauthAuthClient,
  oauthRedirectUrl,
} from '@/lib/oauth-auth-client';
import { orpc } from '@/lib/orpc';
import { AuthLoading } from './auth-loading';

type ConsentClient = {
  clientId: string;
  name: string | null;
  registrationMethod:
    | 'client_id_metadata_document'
    | 'pre_registered'
    | 'dynamic'
    | 'unknown';
  verifiedHost: string | null;
};

type ConsentRequest = {
  clientId: string;
  /** Scopes the app asked for, in request order. */
  scopes: string[];
  /** Where the browser returns after the decision. */
  redirectHost: string | null;
};

/** The authorization the server sent the user to decide on, from the URL. */
function consentRequestFrom(searchParams: URLSearchParams): ConsentRequest | null {
  const clientId = searchParams.get('client_id');
  if (!clientId || !isSignedOAuthRequest(searchParams)) return null;
  let redirectHost: string | null = null;
  try {
    redirectHost = new URL(searchParams.get('redirect_uri') ?? '').host || null;
  } catch {
    redirectHost = null;
  }
  return {
    clientId,
    scopes: (searchParams.get('scope') ?? '').split(' ').filter(Boolean),
    redirectHost,
  };
}

/** Sends the decision; the server answers with the app's callback URL. */
async function submitConsent(accept: boolean, scope?: string) {
  const result = await oauthAuthClient.oauth2.consent({
    accept,
    ...(scope ? { scope } : {}),
  });
  if (result.error) {
    throw new Error(result.error.message ?? 'Unable to record your decision.');
  }
  const next = oauthRedirectUrl(result.data);
  if (!next) throw new Error('The authorization could not be completed.');
  window.location.assign(next);
}

function ClientIdentity({ client }: { client: ConsentClient }) {
  if (client.registrationMethod === 'client_id_metadata_document') {
    return (
      <p className="flex items-center gap-2 text-sm">
        <BadgeCheck className="size-4 text-primary" aria-hidden="true" />
        Identity verified by {client.verifiedHost}
      </p>
    );
  }
  if (client.registrationMethod === 'pre_registered') {
    return (
      <p className="flex items-center gap-2 text-sm">
        <BadgeCheck className="size-4 text-primary" aria-hidden="true" />
        Registered with CampusPilot by an administrator
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      This app registered itself and its name is not verified. Continue only if
      you started this connection.
    </p>
  );
}

/**
 * Signs the current user out and reopens the sign-in page with the same
 * signed OAuth query. The login form forwards that query when signing in, so
 * Better Auth resumes this authorization for the newly signed-in user (who
 * then sees this consent page, or returns to the app if they already
 * consented). The plain `authClient` is used for sign-out so the OAuth query
 * is not attached to that request.
 */
function useSwitchAccount() {
  const router = useRouter();
  const searchParams = useSearchParams();
  return useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error) {
        throw new Error(result.error.message ?? 'Unable to sign out.');
      }
      router.replace(`${OAUTH_LOGIN_PATH}?${searchParams.toString()}`);
    },
  });
}

function SwitchAccount({ email }: { email: string }) {
  const switchAccount = useSwitchAccount();
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{email}</span>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          disabled={switchAccount.isPending}
          onClick={() => switchAccount.mutate()}
        >
          {switchAccount.isPending ? <LoaderCircle className="animate-spin" /> : null}
          Use a different account
        </Button>
      </p>
      {switchAccount.error ? (
        <p className="text-xs text-destructive">{switchAccount.error.message}</p>
      ) : null}
    </div>
  );
}

function ConsentSummary({
  client,
  request,
  email,
}: {
  client: ConsentClient;
  request: ConsentRequest;
  email: string | undefined;
}) {
  const appName = client.name?.trim() || 'This app';
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold tracking-tight">
        Connect {appName} to CampusPilot?
      </h1>
      <ClientIdentity client={client} />
      <p className="text-sm leading-6 text-muted-foreground">
        {appName} can access CampusPilot data for every school you can access,
        with your permissions.
      </p>
      {email ? <SwitchAccount email={email} /> : null}
      {request.redirectHost ? (
        <p className="text-xs text-muted-foreground">
          After you decide, you return to {request.redirectHost}.
        </p>
      ) : null}
    </div>
  );
}

const consentSchema = z.object({ allowChanges: z.boolean() });

/**
 * The decision form. Read access is always part of the grant; the write
 * scope is pre-selected (decided default) and can be removed to make the
 * connection read-only.
 */
function ConsentForm({ request }: { request: ConsentRequest }) {
  const asksForChanges = request.scopes.includes(MCP_WRITE_SCOPE);
  const deny = useMutation({ mutationFn: () => submitConsent(false) });
  const form = useForm({
    defaultValues: { allowChanges: asksForChanges },
    validators: { onSubmit: consentSchema },
    onSubmit: async ({ value }) => {
      const scopes = value.allowChanges
        ? request.scopes
        : request.scopes.filter((scope) => scope !== MCP_WRITE_SCOPE);
      try {
        await submitConsent(true, scopes.join(' '));
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            fields: {},
            form: error instanceof Error ? error.message : 'Unable to connect.',
          },
        });
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <ul className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
        <li>Read your schools’ students, classes, exams, billing and documents</li>
        {asksForChanges ? (
          <form.Field name="allowChanges">
            {(field) => (
              <li className="flex items-start gap-3">
                <Checkbox
                  id="consent-allow-changes"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked === true)}
                />
                <Label htmlFor="consent-allow-changes" className="leading-5 font-normal">
                  Also create, change and delete records
                </Label>
              </li>
            )}
          </form.Field>
        ) : null}
      </ul>
      <form.Subscribe
        selector={(state) => ({
          submitting: state.isSubmitting,
          submitError: state.errorMap.onSubmit,
        })}
      >
        {({ submitting, submitError }) => (
          <ConsentButtons
            submitting={submitting}
            denying={deny.isPending}
            errors={[
              ...(typeof submitError === 'string' ? [submitError] : []),
              ...(deny.error ? [deny.error.message] : []),
            ]}
            onDeny={() => deny.mutate()}
          />
        )}
      </form.Subscribe>
    </form>
  );
}

function ConsentButtons({
  submitting,
  denying,
  errors,
  onDeny,
}: {
  submitting: boolean;
  denying: boolean;
  errors: string[];
  onDeny: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {errors.map((error) => (
        <p key={error} className="text-xs text-destructive">
          {error}
        </p>
      ))}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={submitting || denying}
          onClick={onDeny}
        >
          {denying ? <LoaderCircle className="animate-spin" /> : null}
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || denying}>
          {submitting ? <LoaderCircle className="animate-spin" /> : null}
          Allow access
        </Button>
      </div>
    </div>
  );
}

function ConsentProblem({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold tracking-tight">Cannot connect this app</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="outline" className="self-start">
        <Link href="/school">Go to CampusPilot</Link>
      </Button>
    </div>
  );
}

/**
 * Consent screen for an AI app connecting through OAuth. The server opens it
 * with a signed query after sign-in; the decision is sent with that query.
 */
export function OAuthConsent() {
  const searchParams = useSearchParams();
  const request = consentRequestFrom(searchParams);
  const { data: session } = authClient.useSession();
  const client = useQuery({
    ...orpc.auth.getOAuthConsentClient.queryOptions({
      input: { clientId: request?.clientId ?? '' },
    }),
    enabled: request !== null,
  });

  if (!request) {
    return (
      <ConsentProblem message="This page is opened by an app that asks to connect. Start the connection again from that app." />
    );
  }
  if (client.isPending) return <AuthLoading fullScreen={false} />;
  if (client.isError) {
    return (
      <ConsentProblem message="This app is not known to CampusPilot or has been disabled. Start the connection again from the app." />
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <BrandLogo product="campuspilot" />
      <ConsentSummary client={client.data} request={request} email={session?.user.email} />
      <ConsentForm request={request} />
    </div>
  );
}
