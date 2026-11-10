'use client';

import { readSchoolFeatureDisabled } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { oauthConsentClientSchema } from '@campuspilot/api/routers/auth/auth.dto';
import { CADET_OAUTH_LOGIN_PATH } from '@campuspilot/auth/cadet-policy';
import { Button } from '@campuspilot/ui/components/button';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BadgeCheck, LoaderCircle, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect, useSearchParams } from 'next/navigation';
import type { z } from 'zod';

import { authClient, isSignedOAuthRequest, oauthAuthClient, oauthRedirectUrl } from '@/lib/auth-client';
import { orpc } from '@/lib/orpc';

/** The client facts `getOAuthConsentClient` returns. */
type ConsentClient = z.infer<typeof oauthConsentClientSchema>;

type ConsentRequest = {
  clientId: string;
  /** Where the browser returns after the decision. */
  redirectHost: string | null;
  /**
   * Whether the app asked for `offline_access` (a refresh token), so it can
   * keep reading after the student stops using it. Read from the signed
   * `scope` the app requested.
   */
  staysConnected: boolean;
};

/** The authorization the server sent the student to decide on, from the URL. */
function consentRequestFrom(searchParams: URLSearchParams): ConsentRequest | null {
  const clientId = searchParams.get('client_id');
  if (!clientId || !isSignedOAuthRequest(searchParams)) return null;
  let redirectHost: string | null = null;
  try {
    redirectHost = new URL(searchParams.get('redirect_uri') ?? '').host || null;
  } catch {
    redirectHost = null;
  }
  const scopes = (searchParams.get('scope') ?? '').split(' ');
  return { clientId, redirectHost, staysConnected: scopes.includes('offline_access') };
}

/**
 * Sends the decision with the signed query (the OAuth client plugin adds it);
 * the server answers with the app's callback URL. There is no scope choice:
 * the cadet authorization server only ever grants read access.
 */
async function submitConsent(accept: boolean) {
  const result = await oauthAuthClient.oauth2.consent({ accept });
  if (result.error) throw new Error(result.error.message ?? 'Unable to record your decision.');
  const next = oauthRedirectUrl(result.data);
  if (!next) throw new Error('The connection could not be completed.');
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
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      This app registered itself and its name is not verified. Continue only if you started this connection.
    </p>
  );
}

function ConsentSummary({ client, request }: { client: ConsentClient; request: ConsentRequest }) {
  const appName = client.name?.trim() || 'This app';
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cadet Portal</p>
      <h1 className="text-xl font-semibold tracking-tight">Connect {appName} to your Cadet Portal?</h1>
      <ClientIdentity client={client} />
      <p className="text-sm leading-6 text-muted-foreground">
        {appName} will be able to read your own Cadet Portal details. It cannot change anything.
      </p>
      {request.redirectHost ? (
        <p className="text-xs text-muted-foreground">After you decide, you return to {request.redirectHost}.</p>
      ) : null}
    </div>
  );
}

/**
 * The student's decision. The consent screen has no inputs (the cadet
 * authorization server only grants read access, so there is no scope to
 * choose), so it is two buttons sharing one mutation rather than a form.
 * The variables record which button was pressed, so only that one spins.
 * After success the browser is already leaving, so both stay disabled.
 */
function ConsentDecision() {
  const decide = useMutation({ mutationFn: submitConsent });
  const busy = decide.isPending || decide.isSuccess;
  const pendingChoice = decide.isPending ? decide.variables : null;
  return (
    <div className="flex flex-col gap-3">
      {decide.error ? <p className="text-xs text-destructive">{decide.error.message}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={busy} onClick={() => decide.mutate(false)}>
          {pendingChoice === false ? <LoaderCircle className="animate-spin" /> : null}
          Cancel
        </Button>
        <Button type="button" disabled={busy} onClick={() => decide.mutate(true)}>
          {pendingChoice === true ? <LoaderCircle className="animate-spin" /> : null}
          Allow access
        </Button>
      </div>
    </div>
  );
}

function ConsentScopes({ request }: { request: ConsentRequest }) {
  return (
    <ul className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
      <li>Read your admission details</li>
      {request.staysConnected ? <li>Stay connected when you're not using it</li> : null}
    </ul>
  );
}

function ConsentProblem({ message, title = 'Cannot connect this app' }: { message: string; title?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="outline" className="self-start">
        <Link href="/">Go to the Cadet Portal</Link>
      </Button>
    </div>
  );
}

/**
 * Consent screen for an AI app connecting to the cadet MCP. The cadet
 * authorization server opens it with a signed query after the student signed
 * in; the decision is sent with that query.
 */
export function OAuthConsent() {
  const searchParams = useSearchParams();
  const request = consentRequestFrom(searchParams);
  const { data: session, isPending } = authClient.useSession();
  const client = useQuery({
    ...orpc.getOAuthConsentClient.queryOptions({ input: { clientId: request?.clientId ?? '' } }),
    enabled: request !== null && Boolean(session),
  });

  if (!request) {
    return <ConsentProblem message="This page is opened by an app that asks to connect. Start the connection again from that app." />;
  }
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  // The server only sends a signed-in student here. A lost session restarts
  // sign-in with the same signed query: the sign-in page forwards it, and
  // Better Auth resumes this authorization once the student is signed in.
  if (!session) redirect(`${CADET_OAUTH_LOGIN_PATH}?${searchParams.toString()}`);
  if (client.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (client.isError) {
    // The school's Cadet Portal is switched off: every portal call is
    // refused, this lookup included. The app is not the problem, so the
    // student is not sent back to it to try again.
    if (readSchoolFeatureDisabled(client.error) === 'cadet') {
      return (
        <ConsentProblem
          title="Cadet Portal unavailable"
          message="Your school is not using the Cadet Portal right now, so apps cannot be connected. Please ask your school office for help."
        />
      );
    }
    return <ConsentProblem message="This app is not known to the Cadet Portal or has been disabled. Start the connection again from the app." />;
  }
  return (
    <div className="flex flex-col gap-8">
      <ConsentSummary client={client.data} request={request} />
      <div className="flex flex-col gap-5">
        <ConsentScopes request={request} />
        <ConsentDecision />
      </div>
    </div>
  );
}
