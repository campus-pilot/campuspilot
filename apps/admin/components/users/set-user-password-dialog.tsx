'use client';

import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlatformUserDto } from '@campuspilot/api/routers/system-admin/user/user.dto';
import { IssuedStaffPasswordDialog } from '@campuspilot/components/staff-account/issued-staff-password-dialog';
import {
  staffPasswordIdentifiers,
  staffSignInLabel,
} from '@campuspilot/components/staff-account/staff-sign-in-label';
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
import { RadioGroup, RadioGroupItem } from '@campuspilot/ui/components/radio-group';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import { FieldErrors } from './field-errors';

/** Generate a word password, or type one (at least 8 characters). */
const setPasswordFormSchema = z
  .object({ mode: z.enum(['generate', 'custom']), password: z.string() })
  .refine(({ mode, password }) => mode === 'generate' || password.length >= 8, {
    message: 'Password must contain at least 8 characters.',
    path: ['password'],
  });

function personLabel(user: PlatformUserDto) {
  return user.name.trim() || staffSignInLabel(user);
}

function useSetUserPassword(user: PlatformUserDto) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string | undefined) =>
      client.systemAdmin.setUserPassword({ userId: user.userId, password }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listUsers.key() }),
  });
}

function SetPasswordForm({
  setPassword,
  onCancel,
}: {
  setPassword: ReturnType<typeof useSetUserPassword>;
  onCancel: () => void;
}) {
  const form = useForm({
    defaultValues: { mode: 'generate' as 'generate' | 'custom', password: '' },
    validators: { onSubmit: setPasswordFormSchema },
    onSubmit: async ({ value }) => {
      await setPassword
        .mutateAsync(value.mode === 'custom' ? value.password : undefined)
        .catch(() => undefined);
    },
  });

  return (
    <>
      <form
        id="set-user-password"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field name="mode">
          {(field) => (
            <RadioGroup
              value={field.state.value}
              onValueChange={(value) => field.handleChange(value as 'generate' | 'custom')}
            >
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="generate" />
                Generate a password (for example happy-tiger-27)
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="custom" />
                Type a password
              </Label>
            </RadioGroup>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.mode}>
          {(mode) =>
            mode === 'custom' ? (
              <form.Field name="password">
                {(field) => (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="user-password">Password</Label>
                    <Input
                      id="user-password"
                      type="text"
                      autoComplete="off"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                    <FieldErrors errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>
            ) : null
          }
        </form.Subscribe>
        {setPassword.error ? (
          <p className="text-xs text-destructive">{setPassword.error.message}</p>
        ) : null}
      </form>
      <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
        {({ canSubmit, isSubmitting }) => (
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" form="set-user-password" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? 'Setting…' : 'Set password'}
            </Button>
          </DialogFooter>
        )}
      </form.Subscribe>
    </>
  );
}

/**
 * Sets a person's password (typed or generated), shows it once, and signs
 * them out everywhere. Mounted per user, so each opening starts clean.
 */
export function SetUserPasswordDialog({ user, onClose }: { user: PlatformUserDto; onClose: () => void }) {
  const setPassword = useSetUserPassword(user);
  return (
    <>
      <Dialog
        open={!setPassword.isSuccess}
        onOpenChange={(open) => !open && !setPassword.isPending && onClose()}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{user.hasPassword ? 'Reset password' : 'Set password'}</DialogTitle>
            <DialogDescription>
              {personLabel(user)} will use this password with {staffPasswordIdentifiers(user)}. They
              are signed out everywhere, including connected AI apps.
            </DialogDescription>
          </DialogHeader>
          <SetPasswordForm setPassword={setPassword} onCancel={onClose} />
        </DialogContent>
      </Dialog>
      <IssuedStaffPasswordDialog details={setPassword.data ?? null} onClose={onClose} />
    </>
  );
}
