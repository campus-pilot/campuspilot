'use client';

import { useState } from 'react';
import type { ClassDto } from '@campuspilot/api/routers/school/class/class.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@campuspilot/ui/components/alert-dialog';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import { FormErrors } from './form-errors';
import { RequirePermissions } from './require-permissions';

const settingsSchema = z.object({
  label: z.string().trim().min(1, 'Class name is required').max(200),
  slug: z
    .string()
    .trim()
    .min(1, 'Class slug is required')
    .max(100)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Use lowercase letters, numbers, and single hyphens only',
    ),
});

function ClassSettingsForm({
  schoolClass,
  schoolId,
  sessionId,
}: {
  schoolClass: ClassDto;
  schoolId: string;
  sessionId: string;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const form = useForm({
    defaultValues: { label: schoolClass.label, slug: schoolClass.slug },
    validators: { onSubmit: settingsSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        await client.school.updateClass({
          schoolId,
          classId: schoolClass.id,
          ...settingsSchema.parse(value),
        });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.school.getClass.queryKey({
              input: { schoolId, classId: schoolClass.id },
            }),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.school.listClasses.queryKey({ input: { schoolId } }),
          }),
        ]);
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form:
              error instanceof Error
                ? error.message
                : 'Unable to update this classroom.',
            fields: {},
          },
        });
      }
    },
  });

  async function deleteClass() {
    setDeleteError(undefined);
    setDeleting(true);
    try {
      await client.school.deleteClass({
        schoolId,
        classId: schoolClass.id,
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.school.listClasses.queryKey({ input: { schoolId } }),
      });
      router.replace(
        `/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/classroom`,
      );
    } catch (error) {
      setDeleting(false);
      setDeleteError(
        error instanceof Error
          ? error.message
          : 'Unable to delete this classroom.',
      );
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form
        className="flex max-w-2xl flex-col gap-5 rounded-xl border bg-card p-5"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <div>
          <h2 className="font-semibold">Classroom details</h2>
          <p className="text-sm text-muted-foreground">
            Update the name shown to staff and its stable URL-friendly slug.
          </p>
        </div>
        <form.Field name="label">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-class-label">Class name</Label>
              <Input
                id="settings-class-label"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FormErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="slug">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-class-slug">Class slug</Label>
              <Input
                id="settings-class-slug"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FormErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            errors: state.errors,
            isDirty: state.isDirty,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, errors, isDirty, isSubmitting }) => (
            <div className="flex flex-col items-start gap-3">
              <FormErrors errors={errors} />
              <Button
                type="submit"
                disabled={!canSubmit || !isDirty || isSubmitting}
              >
                {isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>

      <RequirePermissions
        permissions={{
          action: SCHOOL_ACTIONS.DELETE_CLASS,
          resource: { kind: 'school', schoolId },
        }}
      >
        <div className="flex max-w-2xl flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div>
            <h2 className="font-semibold text-destructive">Danger zone</h2>
            <p className="text-sm text-muted-foreground">
              Deleting this classroom also removes all of its sections and
              cannot be undone.
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            Delete classroom
          </Button>
        </div>
      </RequirePermissions>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {schoolClass.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the classroom and every section inside
              it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p className="text-xs text-destructive">{deleteError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void deleteClass()}
            >
              {deleting ? 'Deleting…' : 'Delete classroom'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ClassSettings({
  classId,
  schoolId,
  sessionId,
}: {
  classId: string;
  schoolId: string;
  sessionId: string;
}) {
  const classQuery = useQuery(
    orpc.school.getClass.queryOptions({ input: { schoolId, classId } }),
  );

  if (classQuery.isPending) {
    return <Skeleton className="h-80 w-full max-w-2xl rounded-xl" />;
  }
  if (!classQuery.data) {
    return <p className="text-sm text-destructive">Unable to load classroom.</p>;
  }

  return (
    <ClassSettingsForm
      key={`${classQuery.data.id}-${classQuery.data.updatedAt?.toISOString()}`}
      schoolClass={classQuery.data}
      schoolId={schoolId}
      sessionId={sessionId}
    />
  );
}
