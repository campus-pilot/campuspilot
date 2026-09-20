'use client';

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
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
import { LoaderCircle } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { AccountProfileImage } from './account-profile-image';

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
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Manage account</DialogTitle>
          <DialogDescription>
            Update the personal details shown across CampusPilot.
          </DialogDescription>
        </DialogHeader>
        <div className="border-b p-5 sm:p-6">
          <AccountProfileImage name={name} />
        </div>
        <form
          className="flex flex-col gap-4 p-5 sm:p-6"
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
      </DialogContent>
    </Dialog>
  );
}
