'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import type { SchoolDto } from '@campuspilot/api/routers/system-admin/school/school.dto';
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
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@campuspilot/ui/components/card';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import { DemoCredentialsButton } from './demo-credentials-button';
import { FieldErrors } from './demo-school-fields';

function purgeFormSchema(slug: string) {
  return z.object({
    confirmation: z.string().refine((value) => value === slug, {
      message: `Enter ${slug} exactly to confirm the purge.`,
    }),
  });
}

/**
 * Type-the-slug confirmation for `purgeDemoSchool`, following the existing
 * delete dialog pattern. The database purge commits before the dialog
 * reports success; file cleanup continues in the background.
 */
function PurgeDemoSchoolDialog({
  school,
  open,
  onOpenChange,
}: {
  school: SchoolDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const schema = purgeFormSchema(school.slug);
  const form = useForm({
    defaultValues: { confirmation: '' },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        await client.systemAdmin.purgeDemoSchool({ schoolId: school.id, confirmation: value.confirmation });
        await queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSchools.queryKey({ input: {} }) });
        router.replace('/organizations');
        router.refresh();
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to purge the demo school.', fields: {} },
        });
      }
    },
  });

  /** Prevents dismissal while purging and clears the confirmation between opens. */
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && form.state.isSubmitting) return;
    if (!nextOpen) form.reset();
    onOpenChange(nextOpen);
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Purge {school.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            All demo data, the demo staff accounts and their logins, and all files are removed. Your own
            account stays. File cleanup finishes in the background. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="confirmation">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor="demo-school-purge-confirmation">
                  Enter <span className="font-mono font-semibold">{school.slug}</span> to confirm
                </Label>
                <Input
                  id="demo-school-purge-confirmation"
                  name={field.name}
                  autoComplete="off"
                  spellCheck={false}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              confirmation: state.values.confirmation,
              isSubmitting: state.isSubmitting,
              errors: state.errors,
            })}
          >
            {({ canSubmit, confirmation, isSubmitting, errors }) => (
              <div className="flex flex-col gap-3">
                <FieldErrors errors={errors} />
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={!canSubmit || confirmation !== school.slug || isSubmitting}
                  >
                    {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                    {isSubmitting ? 'Purging…' : 'Purge demo school'}
                  </Button>
                </AlertDialogFooter>
              </div>
            )}
          </form.Subscribe>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Demo-only settings: the credentials download. Rendered only for demo schools. */
export function DemoSchoolCredentialsCard({ schoolId }: { schoolId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Demo school</CardTitle>
        <CardDescription>
          All data in this school is sample data. Download the generated staff logins to share the demo.
        </CardDescription>
      </CardHeader>
      <CardFooter className="border-t">
        <DemoCredentialsButton schoolId={schoolId} />
      </CardFooter>
    </Card>
  );
}

/** Danger-zone purge for a demo school. Rendered only when `school.isDemo`. */
export function PurgeDemoSchoolCard({ school }: { school: SchoolDto }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Permanently remove this demo school, its demo staff accounts and all its files.
        </CardDescription>
      </CardHeader>
      <CardFooter className="border-t">
        <Button type="button" variant="destructive" onClick={() => setIsOpen(true)}>
          <Trash2 aria-hidden />
          Purge demo school
        </Button>
      </CardFooter>
      <PurgeDemoSchoolDialog key={`${school.id}-${school.slug}`} school={school} open={isOpen} onOpenChange={setIsOpen} />
    </Card>
  );
}
