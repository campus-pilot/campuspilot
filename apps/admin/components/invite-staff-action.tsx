'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import {
  type Role,
  roleEnum,
} from '@campuspilot/api/routers/school/member/member.dto';
import { PhoneInput } from '@campuspilot/components/phone-input';
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
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@campuspilot/ui/components/popover';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { ScrollArea } from '@campuspilot/ui/components/scroll-area';
import { ChevronDown, UserPlus } from 'lucide-react';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';

/**
 * Temporary frontend-only class choices. Replace these with school classes from
 * the API before class assignments are included in the invitation payload.
 */
const teacherClassIds = [
  'nursery',
  'lkg',
  'ukg',
  'class-1',
  'class-2',
  'class-3',
  'class-4',
  'class-5',
  'class-6',
  'class-7',
  'class-8',
  'class-9',
  'class-10',
  'class-11',
  'class-12',
] as const;

type TeacherClassId = (typeof teacherClassIds)[number];

const teacherClassLabels: Record<TeacherClassId, string> = {
  nursery: 'Nursery',
  lkg: 'LKG',
  ukg: 'UKG',
  'class-1': 'Class 1',
  'class-2': 'Class 2',
  'class-3': 'Class 3',
  'class-4': 'Class 4',
  'class-5': 'Class 5',
  'class-6': 'Class 6',
  'class-7': 'Class 7',
  'class-8': 'Class 8',
  'class-9': 'Class 9',
  'class-10': 'Class 10',
  'class-11': 'Class 11',
  'class-12': 'Class 12',
};

const inviteStaffFormSchema = z
  .object({
    ...inviteIdentifierShape,
    roles: z.array(roleEnum).min(1, 'Select at least one role.'),
    teacherClassIds: z.array(z.enum(teacherClassIds)),
  })
  .superRefine(refineInviteIdentifier);

const roleLabels = {
  principal: 'Principal',
  teacher: 'Teacher',
  accountant: 'Accountant',
  exam_coordinator: 'Exam coordinator',
  manager: 'Manager',
} as const;

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
  onPasswordIssued,
}: {
  schoolId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPasswordIssued: (details: IssuedStaffPasswordDetails) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: {
      ...defaultInviteIdentifierValues(),
      roles: [] as Role[],
      teacherClassIds: [] as TeacherClassId[],
    },
    validators: { onSubmit: inviteStaffFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const member = await client.school.inviteMember({
          schoolId,
          ...inviteIdentifierInput(value),
          roles: value.roles.map((role) => ({
            role,
            // Class choices are frontend-only for now and are intentionally not sent.
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
            Invite by email or phone number and assign roles in this school.
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
              // Platform administrators may always issue member passwords.
              <InviteIdentifierTabs
                method={methodField.state.value}
                allowPhone
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
                {/* Modal mode gives this portalled popover its own scroll-lock boundary
                    when it is opened from inside the invite dialog. */}
                <Popover modal>
                  <PopoverTrigger asChild>
                    <Button
                      id={field.name}
                      type="button"
                      variant="outline"
                      aria-invalid={field.state.meta.errors.length > 0}
                      className="w-full justify-between font-normal"
                    >
                      <span className="truncate">
                        {field.state.value.length === 0
                          ? 'Select roles'
                          : field.state.value
                              .map((role) => roleLabels[role])
                              .join(', ')}
                      </span>
                      <ChevronDown className="shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-(--radix-popover-trigger-width) min-w-72 gap-1 p-2"
                  >
                    {roleEnum.options.map((role) => (
                      <div key={role}>
                        <Label
                          htmlFor={`${field.name}-${role}`}
                          className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 font-normal hover:bg-accent"
                        >
                          <Checkbox
                            id={`${field.name}-${role}`}
                            checked={field.state.value.includes(role)}
                            onCheckedChange={(checked) => {
                              field.handleChange(
                                checked === true
                                  ? [...field.state.value, role]
                                  : field.state.value.filter(
                                      (value) => value !== role,
                                    ),
                              );
                            }}
                          />
                          {roleLabels[role]}
                        </Label>
                        {role === 'teacher' &&
                        field.state.value.includes('teacher') ? (
                          <form.Field name="teacherClassIds">
                            {(classField) => (
                              <ScrollArea className="ml-6 h-36 overscroll-contain border-l pl-2 pr-3">
                                {teacherClassIds.map((classId) => (
                                  <Label
                                    key={classId}
                                    htmlFor={`teacher-class-${classId}`}
                                    className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 font-normal hover:bg-accent"
                                  >
                                    <Checkbox
                                      id={`teacher-class-${classId}`}
                                      checked={classField.state.value.includes(
                                        classId,
                                      )}
                                      onCheckedChange={(checked) => {
                                        classField.handleChange(
                                          checked === true
                                            ? [
                                                ...classField.state.value,
                                                classId,
                                              ]
                                            : classField.state.value.filter(
                                                (value) => value !== classId,
                                              ),
                                        );
                                      }}
                                    />
                                    {teacherClassLabels[classId]}
                                  </Label>
                                ))}
                              </ScrollArea>
                            )}
                          </form.Field>
                        ) : null}
                      </div>
                    ))}
                  </PopoverContent>
                </Popover>
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
  const [issued, setIssued] = useState<IssuedStaffPasswordDetails | null>(null);

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
        onPasswordIssued={setIssued}
      />
      <IssuedStaffPasswordDialog
        details={issued}
        onClose={() => setIssued(null)}
      />
    </>
  );
}
