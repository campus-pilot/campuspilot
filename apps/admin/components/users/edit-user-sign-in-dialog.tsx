'use client';

import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import type { PlatformUserDto } from '@campuspilot/api/routers/system-admin/user/user.dto';
import {
  PhoneInput,
  phoneInputValueFromStored,
  phoneInputValueSchema,
  phoneInputValueToE164,
} from '@campuspilot/components/phone-input';
import { staffSignInLabel } from '@campuspilot/components/staff-account/staff-sign-in-label';
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
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import { FieldErrors } from './field-errors';

/**
 * Mirrors `updateUserSignIn`: an empty field means "none". A real email can
 * be changed but not cleared, and at least one identifier must remain; the
 * server enforces both again.
 */
function signInFormSchema(hadEmail: boolean) {
  return z
    .object({ email: z.string(), phone: phoneInputValueSchema })
    .superRefine(({ email, phone }, context) => {
      const trimmed = email.trim();
      if (trimmed && !z.email().safeParse(trimmed).success) {
        context.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email address.' });
      }
      if (!trimmed && hadEmail) {
        context.addIssue({ code: 'custom', path: ['email'], message: 'An email address can be changed but not removed.' });
      }
      const hasPhone = phone.number.trim().length > 0;
      if (hasPhone && !phoneInputValueToE164(phone)) {
        context.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a valid phone number for the selected country.' });
      }
      if (!trimmed && !hasPhone) {
        context.addIssue({ code: 'custom', path: ['phone'], message: 'Enter an email address or a phone number.' });
      }
    });
}

function SignInForm({ user, onDone }: { user: PlatformUserDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { email: user.email ?? '', phone: phoneInputValueFromStored(user.phoneNumber) },
    validators: { onSubmit: signInFormSchema(user.email !== null) },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        await client.systemAdmin.updateUserSignIn({
          userId: user.userId,
          email: value.email.trim() || null,
          phoneNumber: value.phone.number.trim() ? phoneInputValueToE164(value.phone) : null,
        });
        await queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listUsers.key() });
        onDone();
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form: error instanceof Error ? error.message : 'Unable to save sign-in details.',
            fields: {},
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
      <form.Field name="email">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              placeholder="name@gmail.com"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="phone">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-phone">Phone number</Label>
            <PhoneInput
              id="user-phone"
              value={field.state.value}
              invalid={field.state.meta.errors.length > 0}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          isDirty: state.isDirty,
          isSubmitting: state.isSubmitting,
          errors: state.errors,
        })}
      >
        {({ canSubmit, isDirty, isSubmitting, errors }) => (
          <>
            <FieldErrors errors={errors} />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isSubmitting} onClick={onDone}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit || !isDirty || isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </>
        )}
      </form.Subscribe>
    </form>
  );
}

/**
 * Changes what a person signs in with. Adding an email lets them also sign
 * in with that email and the same password, or with Google for that address.
 */
export function EditUserSignInDialog({ user, onClose }: { user: PlatformUserDto; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign-in details</DialogTitle>
          <DialogDescription>
            How {user.name.trim() || staffSignInLabel(user)} signs in. Phone number and email share one
            password; an email also enables Continue with Google for that address.
          </DialogDescription>
        </DialogHeader>
        <SignInForm user={user} onDone={onClose} />
      </DialogContent>
    </Dialog>
  );
}
