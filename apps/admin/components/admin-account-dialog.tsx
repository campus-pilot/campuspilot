'use client';

import { useEffect, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  type AccountSection,
  AccountSectionNavigation,
} from '@campuspilot/components/account-section-navigation';
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
import { KeyRound, LoaderCircle, ShieldCheck, UserRound } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { client } from '@/lib/orpc';
import { AccountApiKeys } from './account-api-keys';
import { AccountProfileImage } from './account-profile-image';

type AccountSectionId = 'profile' | 'security' | 'api-keys';

type AdminAccountDialogProps = {
  email: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const sections: readonly AccountSection<AccountSectionId>[] = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'api-keys', label: 'API keys', icon: KeyRound },
];

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string') return message;
  }
  return fallback;
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
      <AccountProfileImage name={initialName} />
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
          await client.auth.setPassword({ newPassword: value.newPassword });
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

export function AdminAccountDialog({
  email,
  name,
  open,
  onOpenChange,
}: AdminAccountDialogProps) {
  const [activeSection, setActiveSection] =
    useState<AccountSectionId>('profile');

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
          <AccountSectionNavigation
            sections={sections}
            activeSection={activeSection}
            onChange={setActiveSection}
          />
          <div className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {activeSection === 'profile' ? (
              <ProfileSection key={name} email={email} initialName={name} />
            ) : null}
            {activeSection === 'security' ? <SecuritySection active /> : null}
            {activeSection === 'api-keys' ? <AccountApiKeys /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
