'use client';

import { Button } from '@campuspilot/ui/components/button';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BadgeCheck, LoaderCircle, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect, useSearchParams } from 'next/navigation';
import { z } from 'zod';

import { authClient, isSignedOAuthRequest, oauthAuthClient, oauthRedirectUrl } from '@/lib/auth-client';
import { orpc } from '@/lib/orpc';

type ConsentClient = {
  clientId: string;
  name: string | null;
  registrationMethod: 'client_id_metadata_document' | 'pre_registered' | 'dynamic' | 'unknown';
  verifiedHost: string | null;
};

type ConsentRequest = {
  clientId: string;
  /** Where the browser returns after the decision. */
  redirectHost: string | null;
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
  return { clientId, redirectHost };
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

const consentSchema = z.object({});

/** Allow submits through the form; Cancel denies with its own mutation. */
function ConsentForm() {
  const deny = useMutation({ mutationFn: () => submitConsent(false) });
  const form = useForm({
    defaultValues: {},
    validators: { onSubmit: consentSchema },
    onSubmit: async () => {
      try {
        await submitConsent(true);
      } catch (error) {
        form.setErrorMap({ onSubmit: { fields: {}, form: error instanceof Error ? error.message : 'Unable to connect.' } });
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
        <li>Read your admission details</li>
      </ul>
      <form.Subscribe selector={(state) => ({ submitting: state.isSubmitting, submitError: state.errorMap.onSubmit })}>
        {({ submitting, submitError }) => (
          <div className="flex flex-col gap-3">
            {[...(typeof submitError === 'string' ? [submitError] : []), ...(deny.error ? [deny.error.message] : [])].map((error) => (
              <p key={error} className="text-xs text-destructive">{error}</p>
            ))}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={submitting || deny.isPending} onClick={() => deny.mutate()}>
                {deny.isPending ? <LoaderCircle className="animate-spin" /> : null}
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || deny.isPending}>
                {submitting ? <LoaderCircle className="animate-spin" /> : null}
                Allow access
              </Button>
            </div>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

function ConsentProblem({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold tracking-tight">Cannot connect this app</h1>
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
  // The server only sends a signed-in student here; a lost session restarts sign-in.
  if (!session) redirect('/sign-in');
  if (client.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (client.isError) {
    return <ConsentProblem message="This app is not known to the Cadet Portal or has been disabled. Start the connection again from the app." />;
  }
  return (
    <div className="flex flex-col gap-8">
      <ConsentSummary client={client.data} request={request} />
      <ConsentForm />
    </div>
  );
}
