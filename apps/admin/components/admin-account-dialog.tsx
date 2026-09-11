'use client';

import { useCallback, useEffect, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { env } from '@campuspilot/env/admin.client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@campuspilot/ui/components/alert-dialog';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Separator } from '@campuspilot/ui/components/separator';
import {
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { authClient } from '@/lib/auth-client';

type AccountSection = 'profile' | 'security' | 'api-keys';

type ApiKey = {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  createdAt: Date;
  lastRequest: Date | null;
};

type AdminAccountDialogProps = {
  email: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const sections = [
  { id: 'profile' as const, label: 'Profile', icon: UserRound },
  { id: 'security' as const, label: 'Security', icon: ShieldCheck },
  { id: 'api-keys' as const, label: 'API keys', icon: KeyRound },
];

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

function SectionNavigation({
  activeSection,
  onChange,
}: {
  activeSection: AccountSection;
  onChange: (section: AccountSection) => void;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b p-2 md:w-44 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:p-3">
      {sections.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          type="button"
          variant={activeSection === id ? 'secondary' : 'ghost'}
          className="shrink-0 justify-start rounded-lg"
          onClick={() => onChange(id)}
        >
          <Icon />
          {label}
        </Button>
      ))}
    </nav>
  );
}

function ProfileSection({
  email,
  initialName,
}: {
  email: string;
  initialName: string;
}) {
  const [message, setMessage] = useState<string>();
  const form = useForm({
    defaultValues: { name: initialName },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, 'Full name is required.'),
      }),
    },
    onSubmit: async ({ value }) => {
      setMessage(undefined);
      const name = value.name.trim();
      const { error } = await authClient.updateUser({ name });
      setMessage(error ? error.message : 'Profile updated.');
      if (!error) form.reset({ name });
    },
  });

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">Profile</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Update the name shown across CampusPilot.
        </p>
      </div>
      <form
        className="flex max-w-md flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <div className="flex flex-col gap-2">
          <form.Field name="name">
            {(field) => (
              <>
                <Label htmlFor="account-name">Full name</Label>
                <Input
                  id="account-name"
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  autoComplete="name"
                />
                {field.state.meta.errors.map((error) =>
                  error?.message ? (
                    <p key={error.message} className="text-xs text-destructive">
                      {error.message}
                    </p>
                  ) : null,
                )}
              </>
            )}
          </form.Field>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-email">Email address</Label>
          <Input id="account-email" value={email} disabled readOnly />
          <p className="text-[11px] text-muted-foreground">
            Your email address cannot be changed here.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isDirty: state.isDirty,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isDirty, isSubmitting }) => (
              <Button
                type="submit"
                disabled={!canSubmit || !isDirty || isSubmitting}
              >
                {isSubmitting ? (
                  <LoaderCircle className="animate-spin" />
                ) : null}
                Save changes
              </Button>
            )}
          </form.Subscribe>
          {message ? (
            <p className="text-xs text-muted-foreground">{message}</p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function usePasswordState(active: boolean) {
  const [hasPassword, setHasPassword] = useState<boolean>();
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    if (!active || hasPassword !== undefined) return;
    let isCurrent = true;

    authClient.listAccounts().then(({ data, error }) => {
      if (!isCurrent) return;
      if (error) setLoadError(error.message);
      else
        setHasPassword(
          data.some((account) => account.providerId === 'credential'),
        );
    });

    return () => {
      isCurrent = false;
    };
  }, [active, hasPassword]);

  return { hasPassword, setHasPassword, loadError };
}

function SecuritySection({ active }: { active: boolean }) {
  const { hasPassword, setHasPassword, loadError } = usePasswordState(active);
  const [message, setMessage] = useState<string>();
  const form = useForm({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmation: '',
    },
    validators: {
      onSubmit: z
        .object({
          currentPassword: z.string(),
          newPassword: z
            .string()
            .min(8, 'Password must contain at least 8 characters.'),
          confirmation: z.string(),
        })
        .refine(
          ({ newPassword, confirmation }) => newPassword === confirmation,
          {
            message: 'New passwords do not match.',
            path: ['confirmation'],
          },
        )
        .refine(
          ({ currentPassword }) => !hasPassword || currentPassword.length > 0,
          {
            message: 'Current password is required.',
            path: ['currentPassword'],
          },
        ),
    },
    onSubmit: async ({ value }) => {
      setMessage(undefined);
      try {
        if (hasPassword) {
          const { error } = await authClient.changePassword({
            currentPassword: value.currentPassword,
            newPassword: value.newPassword,
            revokeOtherSessions: true,
          });
          if (error) throw error;
        } else {
          const response = await fetch(
            new URL('/api/account/set-password', env.NEXT_PUBLIC_SERVER_URL),
            {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ newPassword: value.newPassword }),
            },
          );
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as {
              message?: string;
            } | null;
            throw new Error(body?.message ?? 'Unable to set password.');
          }
          setHasPassword(true);
        }

        form.reset();
        setMessage(hasPassword ? 'Password changed.' : 'Password created.');
      } catch (error) {
        setMessage(errorMessage(error, 'Unable to update password.'));
      }
    },
  });

  if (hasPassword === undefined) {
    return (
      <section className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        {loadError ?? 'Checking password status…'}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">Security</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasPassword
            ? 'Change your password and sign out your other sessions.'
            : 'Add a password so you can also sign in with your email.'}
        </p>
      </div>
      <form
        className="flex max-w-md flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        {hasPassword ? (
          <div className="flex flex-col gap-2">
            <form.Field name="currentPassword">
              {(field) => (
                <>
                  <Label htmlFor="current-password">Current password</Label>
                  <Input
                    id="current-password"
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    autoComplete="current-password"
                  />
                  {field.state.meta.errors.map((error) =>
                    error?.message ? (
                      <p
                        key={error.message}
                        className="text-xs text-destructive"
                      >
                        {error.message}
                      </p>
                    ) : null,
                  )}
                </>
              )}
            </form.Field>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <form.Field name="newPassword">
            {(field) => (
              <>
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  name={field.name}
                  type="password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  autoComplete="new-password"
                />
                {field.state.meta.errors.map((error) =>
                  error?.message ? (
                    <p key={error.message} className="text-xs text-destructive">
                      {error.message}
                    </p>
                  ) : null,
                )}
              </>
            )}
          </form.Field>
        </div>
        <div className="flex flex-col gap-2">
          <form.Field name="confirmation">
            {(field) => (
              <>
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  name={field.name}
                  type="password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  autoComplete="new-password"
                />
                {field.state.meta.errors.map((error) =>
                  error?.message ? (
                    <p key={error.message} className="text-xs text-destructive">
                      {error.message}
                    </p>
                  ) : null,
                )}
              </>
            )}
          </form.Field>
        </div>
        <div className="flex items-center gap-3">
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? (
                  <LoaderCircle className="animate-spin" />
                ) : null}
                {hasPassword ? 'Change password' : 'Set password'}
              </Button>
            )}
          </form.Subscribe>
          {message ? (
            <p className="text-xs text-muted-foreground">{message}</p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function ApiKeyRow({
  apiKey,
  onDelete,
}: {
  apiKey: ApiKey;
  onDelete: (id: string) => void;
}) {
  const visibleKey = [apiKey.start].filter(Boolean).join('') || 'Key';

  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
        <KeyRound className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">
            {apiKey.name || 'Unnamed key'}
          </p>
          <Badge variant="outline">{visibleKey}…</Badge>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Created {new Date(apiKey.createdAt).toLocaleDateString()}
          {apiKey.lastRequest
            ? ` · Last used ${new Date(apiKey.lastRequest).toLocaleDateString()}`
            : ' · Never used'}
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete API key"
          >
            <Trash2 />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API key?</AlertDialogTitle>
            <AlertDialogDescription>
              Any integration using this key will immediately stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => onDelete(apiKey.id)}
            >
              Delete key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ApiKeysSection({ active }: { active: boolean }) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [createdKey, setCreatedKey] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string>();
  const [copied, setCopied] = useState(false);

  const loadApiKeys = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await authClient.apiKey.list();
    setIsLoading(false);
    if (error) setMessage(error.message);
    else setApiKeys(data.apiKeys);
  }, []);

  useEffect(() => {
    if (active) void loadApiKeys();
  }, [active, loadApiKeys]);

  const form = useForm({
    defaultValues: { name: '' },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, 'Key name is required.'),
      }),
    },
    onSubmit: async ({ value }) => {
      setMessage(undefined);
      const { data, error } = await authClient.apiKey.create({
        name: value.name.trim(),
      });
      if (error) {
        setMessage(error.message);
        return;
      }
      form.reset();
      setCopied(false);
      setCreatedKey(data.key);
      await loadApiKeys();
    },
  });

  async function deleteApiKey(id: string) {
    const { error } = await authClient.apiKey.delete({ keyId: id });
    if (error) setMessage(error.message);
    else setApiKeys((current) => current.filter((apiKey) => apiKey.id !== id));
  }

  async function copyCreatedKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">API keys</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Create credentials for scripts and integrations accessing your
          account.
        </p>
      </div>
      <form
        className="flex max-w-lg items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <div className="flex flex-1 flex-col gap-2">
          <form.Field name="name">
            {(field) => (
              <>
                <Label htmlFor="api-key-name">Key name</Label>
                <Input
                  id="api-key-name"
                  name={field.name}
                  value={field.state.value}
                  placeholder="Production integration"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {field.state.meta.errors.map((error) =>
                  error?.message ? (
                    <p key={error.message} className="text-xs text-destructive">
                      {error.message}
                    </p>
                  ) : null,
                )}
              </>
            )}
          </form.Field>
        </div>
        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <KeyRound />
              )}
              Create key
            </Button>
          )}
        </form.Subscribe>
      </form>
      {createdKey ? (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div>
            <p className="text-sm font-medium">Copy your new API key</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              This key is only shown once. Store it somewhere secure.
            </p>
          </div>
          <div className="flex gap-2">
            <Input value={createdKey} readOnly className="font-mono" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copyCreatedKey}
            >
              {copied ? <Check /> : <Clipboard />}
              <span className="sr-only">Copy API key</span>
            </Button>
          </div>
        </div>
      ) : null}
      <Separator />
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Active keys</h3>
        {isLoading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Loading keys…
          </p>
        ) : null}
        {!isLoading && apiKeys.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
            You have not created any API keys.
          </p>
        ) : null}
        {apiKeys.map((apiKey) => (
          <ApiKeyRow key={apiKey.id} apiKey={apiKey} onDelete={deleteApiKey} />
        ))}
        {message ? <p className="text-xs text-destructive">{message}</p> : null}
      </div>
    </section>
  );
}

export function AdminAccountDialog({
  email,
  name,
  open,
  onOpenChange,
}: AdminAccountDialogProps) {
  const [activeSection, setActiveSection] = useState<AccountSection>('profile');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl w-full gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Manage account</DialogTitle>
          <DialogDescription>
            Update your personal account and credentials.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <SectionNavigation
            activeSection={activeSection}
            onChange={setActiveSection}
          />
          <div className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {activeSection === 'profile' ? (
              <ProfileSection key={name} email={email} initialName={name} />
            ) : null}
            {activeSection === 'security' ? <SecuritySection active /> : null}
            {activeSection === 'api-keys' ? <ApiKeysSection active /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
