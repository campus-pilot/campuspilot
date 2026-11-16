'use client';

import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { LoaderCircle } from 'lucide-react';
import { z } from 'zod';

/** What the form submits: the current password only when one exists. */
export type AccountPasswordChange = {
  currentPassword: string | null;
  newPassword: string;
};

function passwordFormSchema(hasPassword: boolean) {
  return z
    .object({
      currentPassword: z.string(),
      newPassword: z.string().min(8, 'Password must contain at least 8 characters.'),
      confirmation: z.string(),
    })
    .refine(({ newPassword, confirmation }) => newPassword === confirmation, {
      message: 'New passwords do not match.',
      path: ['confirmation'],
    })
    .refine(({ currentPassword }) => !hasPassword || currentPassword.length > 0, {
      message: 'Current password is required.',
      path: ['currentPassword'],
    });
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Unable to update password.';
}

function FieldErrors({ errors }: { errors: unknown[] }) {
  return errors.map((error, index) => {
    const message =
      typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : undefined;
    return message ? (
      <p key={`${message}-${index}`} className="text-xs text-destructive">
        {message}
      </p>
    ) : null;
  });
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  errors,
  onBlur,
  onChange,
}: {
  id: string;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  value: string;
  errors: unknown[];
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        value={value}
        autoComplete={autoComplete}
        aria-invalid={errors.length > 0}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldErrors errors={errors} />
    </div>
  );
}

/**
 * Lets a signed-in person change their password, or create one when the
 * account has none yet (for example someone who only used Google). Phone and
 * email sign-in share this one password. The app performs the change through
 * `onSubmit`; a rejected promise is shown under the form.
 */
export function AccountPasswordForm({
  hasPassword,
  onSubmit,
}: {
  hasPassword: boolean;
  onSubmit: (change: AccountPasswordChange) => Promise<void>;
}) {
  const save = useMutation({ mutationFn: onSubmit });
  const form = useForm({
    defaultValues: { currentPassword: '', newPassword: '', confirmation: '' },
    validators: { onSubmit: passwordFormSchema(hasPassword) },
    onSubmit: async ({ value }) => {
      await save
        .mutateAsync({
          currentPassword: hasPassword ? value.currentPassword : null,
          newPassword: value.newPassword,
        })
        .then(() => form.reset())
        .catch(() => undefined);
    },
  });

  return (
    <form
      className="flex max-w-md flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      {hasPassword ? (
        <form.Field name="currentPassword">
          {(field) => (
            <PasswordField
              id="current-password"
              label="Current password"
              autoComplete="current-password"
              value={field.state.value}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
      ) : null}
      <form.Field name="newPassword">
        {(field) => (
          <PasswordField
            id="new-password"
            label="New password"
            autoComplete="new-password"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <form.Field name="confirmation">
        {(field) => (
          <PasswordField
            id="confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
        {({ canSubmit, isSubmitting }) => (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
              {hasPassword ? 'Change password' : 'Set password'}
            </Button>
            {save.isError ? <p className="text-xs text-destructive">{errorMessage(save.error)}</p> : null}
            {save.isSuccess && !isSubmitting ? (
              <p className="text-xs text-muted-foreground">Password saved.</p>
            ) : null}
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
