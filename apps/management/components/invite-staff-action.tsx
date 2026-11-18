'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import {
  roleEnum,
  type Role,
} from '@campuspilot/api/routers/school/member/member.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  defaultInviteIdentifierValues,
  InviteIdentifierTabs,
  inviteIdentifierInput,
  inviteIdentifierShape,
  refineInviteIdentifier,
} from '@campuspilot/components/staff-account/invite-identifier';
import {
  IssuedStaffPasswordDialog,
  type IssuedStaffPasswordDetails,
} from '@campuspilot/components/staff-account/issued-staff-password-dialog';
import { PhoneInput } from '@campuspilot/components/phone-input';
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
import { RequirePermissions } from './require-permissions';
import { StaffRolePicker } from './staff-role-picker';

const inviteStaffFormSchema = z
  .object({
    ...inviteIdentifierShape,
    roles: z.array(roleEnum).min(1, 'Select at least one role.'),
  })
  .superRefine(refineInviteIdentifier);

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
  allowPhone,
  onOpenChange,
  onPasswordIssued,
}: {
  schoolId: string;
  open: boolean;
  /** Whether the caller may issue passwords, which inviting by phone does. */
  allowPhone: boolean;
  onOpenChange: (open: boolean) => void;
  onPasswordIssued: (details: IssuedStaffPasswordDetails) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { ...defaultInviteIdentifierValues(), roles: [] as Role[] },
    validators: { onSubmit: inviteStaffFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const member = await client.school.inviteMember({
          schoolId,
          ...inviteIdentifierInput(value),
          roles: value.roles.map((role) => ({
            role,
            meta: role === 'teacher' ? { classIds: null } : null,
          })),
        });
        await queryClient.invalidateQueries({
          queryKey: orpc.school.listMembers.queryKey({ input: { schoolId } }),
        });
        form.reset();
        onOpenChange(false);
        if (member.issuedPassword) {
          onPasswordIssued({ ...member, password: member.issuedPassword });
        }
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

  const emailField = (
    <form.Field name="email">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
          <FieldErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
  const phoneField = (
    <form.Field name="phone">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-phone">Phone number</Label>
          <PhoneInput
            id="invite-phone"
            value={field.state.value}
            invalid={field.state.meta.errors.length > 0}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
          />
          <FieldErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );

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
            {allowPhone
              ? 'Invite by email or phone number and assign roles in this school.'
              : 'Invite by email and assign roles in this school.'}
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
          <form.Field name="method">
            {(methodField) => (
              <InviteIdentifierTabs
                method={methodField.state.value}
                allowPhone={allowPhone}
                onMethodChange={methodField.handleChange}
                email={emailField}
                phone={phoneField}
              />
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

/**
 * "Invite staff" with its permission gate, so the Staff navbar and empty
 * states (the staff table, the class teacher picker) render the same entry
 * point and the same dialog.
 */
export function InviteStaffAction({ schoolId }: { schoolId: string }) {
  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.INVITE_MEMBER,
        resource: { kind: 'school', schoolId },
      }}
    >
      <InviteStaffButton schoolId={schoolId} />
    </RequirePermissions>
  );
}

function InviteStaffButton({ schoolId }: { schoolId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedStaffPasswordDetails | null>(null);
  const dialog = (allowPhone: boolean) => (
    <InviteStaffDialog
      schoolId={schoolId}
      open={isOpen}
      allowPhone={allowPhone}
      onOpenChange={setIsOpen}
      onPasswordIssued={setIssued}
    />
  );

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-lg"
        onClick={() => setIsOpen(true)}
      >
        <UserPlus />
        Invite staff
      </Button>
      {/* Inviting by phone issues a password, so it is offered only to
          staff who may issue member passwords; the server checks again. */}
      <RequirePermissions
        permissions={{
          action: SCHOOL_ACTIONS.ISSUE_MEMBER_PASSWORD,
          resource: { kind: 'school', schoolId },
        }}
        fallback={dialog(false)}
      >
        {dialog(true)}
      </RequirePermissions>
      <IssuedStaffPasswordDialog
        details={issued}
        onClose={() => setIssued(null)}
      />
    </>
  );
}
