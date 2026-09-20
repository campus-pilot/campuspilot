'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import {
  inviteSchoolMemberInputSchema,
  roleEnum,
  type Role,
} from '@campuspilot/api/routers/school/member/member.dto';
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
import { UserPlus } from 'lucide-react';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import { StaffRolePicker } from './staff-role-picker';

const inviteStaffFormSchema = z.object({
  email: inviteSchoolMemberInputSchema.shape.email,
  roles: z.array(roleEnum).min(1, 'Select at least one role.'),
});

function FieldErrors({ errors }: { errors: unknown[] }) {
  return errors.map((error, index) => {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : undefined;
    return message ? (
      <p key={`${message}-${index}`} className="text-xs text-destructive">
        {message}
      </p>
    ) : null;
  });
}

function InviteStaffDialog({
  schoolId,
  open,
  onOpenChange,
}: {
  schoolId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { email: '', roles: [] as Role[] },
    validators: { onSubmit: inviteStaffFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const validated = inviteStaffFormSchema.parse(value);
        await client.school.inviteMember({
          schoolId,
          email: validated.email,
          roles: validated.roles.map((role) => ({
            role,
            meta: role === 'teacher' ? { classIds: null } : null,
          })),
        });
        await queryClient.invalidateQueries({
          queryKey: orpc.school.listMembers.queryKey({ input: { schoolId } }),
        });
        form.reset();
        onOpenChange(false);
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form:
              error instanceof Error
                ? error.message
                : 'Unable to invite this staff member.',
            fields: {},
          },
        });
      }
    },
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) form.reset();
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite staff member</DialogTitle>
          <DialogDescription>
            Invite by email and assign roles in this school.
          </DialogDescription>
        </DialogHeader>
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
                <Label htmlFor={field.name}>Email</Label>
                <Input
                  id={field.name}
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Field name="roles">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor={field.name}>Roles</Label>
                <StaffRolePicker
                  id={field.name}
                  roles={field.state.value}
                  invalid={field.state.meta.errors.length > 0}
                  onChange={field.handleChange}
                />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
              errors: state.errors,
            })}
          >
            {({ canSubmit, isSubmitting, errors }) => (
              <>
                <FieldErrors errors={errors} />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={() => handleOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? 'Inviting…' : 'Invite staff'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InviteStaffAction({ schoolId }: { schoolId: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="rounded-lg"
        onClick={() => setIsOpen(true)}
      >
        <UserPlus />
        Invite staff
      </Button>
      <InviteStaffDialog
        schoolId={schoolId}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    </>
  );
}
