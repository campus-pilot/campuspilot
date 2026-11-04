'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@campuspilot/ui/components/select';
import { Textarea } from '@campuspilot/ui/components/textarea';
import { LoaderCircle, Plus } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import { ClientSecretDialog } from './oauth-clients-table';

type AuthMethod = 'client_secret_basic' | 'client_secret_post';

/** One redirect URI per line; blank lines are ignored. */
function redirectUrisFrom(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const newClientSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100),
  redirectUris: z.string().refine(
    (text) => {
      const uris = redirectUrisFrom(text);
      return (
        uris.length > 0 &&
        uris.length <= 10 &&
        uris.every((uri) => z.url({ protocol: /^https?$/ }).safeParse(uri).success)
      );
    },
    'Enter one to ten http(s) redirect URIs, one per line.',
  ),
  tokenEndpointAuthMethod: z.enum(['client_secret_basic', 'client_secret_post']),
});

function FieldErrors({ errors }: { errors: unknown[] }) {
  return errors.map((error, index) => {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : null;
    return message ? (
      <p key={`${message}-${index}`} className="text-xs text-destructive">
        {message}
      </p>
    ) : null;
  });
}

function NewOAuthClientForm({
  onCreate,
  onCancel,
}: {
  onCreate: (input: {
    name: string;
    redirectUris: string[];
    tokenEndpointAuthMethod: AuthMethod;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const form = useForm({
    defaultValues: {
      name: '',
      redirectUris: '',
      tokenEndpointAuthMethod: 'client_secret_basic' as AuthMethod,
    },
    validators: { onSubmit: newClientSchema },
    onSubmit: async ({ value }) => {
      try {
        await onCreate({
          name: value.name.trim(),
          redirectUris: redirectUrisFrom(value.redirectUris),
          tokenEndpointAuthMethod: value.tokenEndpointAuthMethod,
        });
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            fields: {},
            form: error instanceof Error ? error.message : 'Unable to create the client.',
          },
        });
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="oauth-client-name">Name shown on the consent screen</Label>
            <Input
              id="oauth-client-name"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="Gemini Enterprise"
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="redirectUris">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="oauth-client-redirects">Redirect URIs (one per line)</Label>
            <Textarea
              id="oauth-client-redirects"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="https://vertexaisearch.cloud.google.com/oauth-redirect"
              className="font-mono text-xs"
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="tokenEndpointAuthMethod">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="oauth-client-auth">Client authentication</Label>
            <Select
              value={field.state.value}
              onValueChange={(value) => field.handleChange(value as AuthMethod)}
            >
              <SelectTrigger id="oauth-client-auth" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client_secret_basic">HTTP Basic (client_secret_basic)</SelectItem>
                <SelectItem value="client_secret_post">Form body (client_secret_post)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) => ({
          submitting: state.isSubmitting,
          submitError: state.errorMap.onSubmit,
        })}
      >
        {({ submitting, submitError }) => (
          <>
            {typeof submitError === 'string' ? (
              <p className="text-xs text-destructive">{submitError}</p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle className="animate-spin" /> : null}
                Create client
              </Button>
            </DialogFooter>
          </>
        )}
      </form.Subscribe>
    </form>
  );
}

/** Navbar action that pre-registers an OAuth client and reveals its secret once. */
export function NewOAuthClientAction() {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (input: Parameters<typeof client.systemAdmin.createOAuthClient>[0]) =>
      client.systemAdmin.createOAuthClient(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listOAuthClients.key() }),
  });

  return (
    <>
      <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setIsOpen(true)}>
        <Plus />
        New OAuth client
      </Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New OAuth client</DialogTitle>
            <DialogDescription>
              For AI apps that need a client ID and secret, such as Gemini Enterprise or a
              ChatGPT predefined client. Users still see the consent screen.
            </DialogDescription>
          </DialogHeader>
          {isOpen ? (
            <NewOAuthClientForm
              onCancel={() => setIsOpen(false)}
              onCreate={async (input) => {
                await create.mutateAsync(input);
                setIsOpen(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ClientSecretDialog credentials={create.data ?? null} onClose={() => create.reset()} />
    </>
  );
}
