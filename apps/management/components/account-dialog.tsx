'use client';

import { useState } from 'react';
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
import { Bot, KeyRound, LoaderCircle, UserRound } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { AccountApiKeys } from './account-api-keys';
import { AccountConnectedApps } from './account-connected-apps';
import { AccountProfileImage } from './account-profile-image';

type AccountSectionId = 'profile' | 'connected-apps' | 'api-keys';

const sections: readonly AccountSection<AccountSectionId>[] = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'connected-apps', label: 'Connected apps', icon: Bot },
  { id: 'api-keys', label: 'API keys', icon: KeyRound },
];

function ProfileSection({
  email,
  name,
  onSaved,
}: {
  email: string;
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
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-email">Email address</Label>
          <Input id="account-email" value={email} disabled readOnly />
        </div>
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

export function AccountDialog({
  email,
  name,
  open,
  onOpenChange,
}: {
  email: string;
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
                email={email}
                name={name}
                onSaved={() => onOpenChange(false)}
              />
            ) : null}
            {activeSection === 'connected-apps' ? <AccountConnectedApps /> : null}
            {activeSection === 'api-keys' ? <AccountApiKeys /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
