'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { AccountPasswordForm } from '@campuspilot/components/staff-account/account-password-form';
import {
  formatStaffPhoneNumber,
  type StaffSignInIdentity,
} from '@campuspilot/components/staff-account/staff-sign-in-label';
import { Bot, KeyRound, LoaderCircle, LockKeyhole, UserRound } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { client } from '@/lib/orpc';
import { AccountApiKeys } from './account-api-keys';
import { AccountConnectedApps } from './account-connected-apps';
import { AccountProfileImage } from './account-profile-image';

type AccountSectionId = 'profile' | 'password' | 'connected-apps' | 'api-keys';

const sections: readonly AccountSection<AccountSectionId>[] = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'password', label: 'Password', icon: LockKeyhole },
  { id: 'connected-apps', label: 'Connected apps', icon: Bot },
  { id: 'api-keys', label: 'API keys', icon: KeyRound },
];

/** Read-only sign-in identifiers; only administrators can change them. */
function SignInDetails({ identity }: { identity: StaffSignInIdentity }) {
  return (
    <>
      {identity.email ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-email">Email address</Label>
          <Input id="account-email" value={identity.email} disabled readOnly />
        </div>
      ) : null}
      {identity.phoneNumber ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-phone">Phone number</Label>
          <Input
            id="account-phone"
            value={formatStaffPhoneNumber(identity.phoneNumber)}
            disabled
            readOnly
          />
        </div>
      ) : null}
    </>
  );
}

function ProfileSection({
  identity,
  name,
  onSaved,
}: {
  identity: StaffSignInIdentity;
  name: string;
  onSaved: () => void;
}) {
  const form = useForm({
    defaultValues: { name },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, 'Full name is required.'),
      }),
    },
    onSubmit: async ({ value }) => {
      const nextName = value.name.trim();
      const { error } = await authClient.updateUser({ name: nextName });
      if (error) throw error;
      form.reset({ name: nextName });
      onSaved();
    },
  });

  return (
    <section className="flex flex-col gap-5">
      <AccountProfileImage name={name} />
      <form
        className="flex max-w-md flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field name="name">
          {(field) => (
            <div className="flex flex-col gap-2">
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
            </div>
          )}
        </form.Field>
        <SignInDetails identity={identity} />
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
              className="self-start"
              disabled={!canSubmit || !isDirty || isSubmitting}
            >
              {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
              Save changes
            </Button>
          )}
        </form.Subscribe>
      </form>
    </section>
  );
}

const ACCOUNTS_QUERY_KEY = ['auth', 'accounts'] as const;

/**
 * Whether the account has a password (a credential account). Phone and email
 * sign-in share it, so this one form covers both.
 */
function PasswordSection() {
  const queryClient = useQueryClient();
  const accounts = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  if (!accounts.data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {accounts.isError ? null : <LoaderCircle className="size-4 animate-spin" />}
        {accounts.isError ? 'Unable to check your password status.' : 'Checking password status…'}
      </p>
    );
  }

  const hasPassword = accounts.data.some((item) => item.providerId === 'credential');
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Password</h2>
        <p className="text-xs text-muted-foreground">
          {hasPassword
            ? 'Change your password and sign out your other sessions. It is used with both your phone number and your email.'
            : 'Add a password so you can also sign in without Google.'}
        </p>
      </div>
      <AccountPasswordForm
        key={String(hasPassword)}
        hasPassword={hasPassword}
        onSubmit={async ({ currentPassword, newPassword }) => {
          if (currentPassword === null) {
            await client.auth.setPassword({ newPassword });
          } else {
            const { error } = await authClient.changePassword({
              currentPassword,
              newPassword,
              revokeOtherSessions: true,
            });
            if (error) throw new Error(error.message ?? 'Unable to change password.');
          }
          await queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
        }}
      />
    </section>
  );
}

export function AccountDialog({
  identity,
  name,
  open,
  onOpenChange,
}: {
  identity: StaffSignInIdentity;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [activeSection, setActiveSection] =
    useState<AccountSectionId>('profile');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-full flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Manage account</DialogTitle>
          <DialogDescription>
            Update your personal details and the credentials that act as you.
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
              <ProfileSection
                key={name}
                identity={identity}
                name={name}
                onSaved={() => onOpenChange(false)}
              />
            ) : null}
            {activeSection === 'password' ? <PasswordSection /> : null}
            {activeSection === 'connected-apps' ? <AccountConnectedApps /> : null}
            {activeSection === 'api-keys' ? <AccountApiKeys /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
