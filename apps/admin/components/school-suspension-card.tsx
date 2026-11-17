'use client';

import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import {
  suspendSchoolInputSchema,
  type SchoolDto,
} from '@campuspilot/api/routers/system-admin/school/school.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Label } from '@campuspilot/ui/components/label';
import { Textarea } from '@campuspilot/ui/components/textarea';
import { toast } from '@campuspilot/ui/lib/toast';
import { LoaderCircle } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import { SchoolSuspendedBadge } from './school-badges';

const suspensionFormSchema = z.object({ reason: suspendSchoolInputSchema.shape.reason });

const REASON_MAX_LENGTH = 1000;

const suspendedSince = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/** What suspending does, said before it is confirmed. */
const SUSPEND_CONSEQUENCE =
  'Staff and students of this school can still sign in and view everything, but every change is refused: in the management app, the Cadet Portal, the AI assistant and connected AI apps. They see "This school is suspended, contact support" and never your reason. Nothing is deleted, and lifting the suspension restores everything at once.';

/**
 * Puts the server's school (after suspending, changing the reason or
 * lifting) where the admin app reads it: the school itself, and the lists
 * that show its Suspended badge.
 */
function useStoreSchool() {
  const queryClient = useQueryClient();
  return (school: SchoolDto) => {
    queryClient.setQueryData(orpc.systemAdmin.getSchool.queryKey({ input: { id: school.id } }), school);
    void queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSchools.key() });
  };
}

function errorMessages(errors: unknown[]): string[] {
  return errors.flatMap((error) => {
    if (typeof error === 'string') return [error];
    if (typeof error !== 'object' || error === null) return [];
    if ('form' in error) return [String(error.form)];
    return 'message' in error ? [String(error.message)] : [];
  });
}

function ErrorLines({ errors }: { errors: unknown[] }) {
  return errorMessages(errors).map((message) => (
    <p key={message} className="text-xs text-destructive">
      {message}
    </p>
  ));
}

/**
 * The reason form. It suspends a school that is not suspended, and replaces
 * the reason of one that is (the server keeps the moment it was first
 * suspended): both are `systemAdmin.suspendSchool`.
 */
function useSuspensionForm(school: SchoolDto) {
  const storeSchool = useStoreSchool();
  const form = useForm({
    defaultValues: { reason: school.suspendedReason ?? '' },
    validators: { onSubmit: suspensionFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        storeSchool(await client.systemAdmin.suspendSchool({ id: school.id, reason: value.reason }));
        toast.success(school.suspendedAt ? 'Suspension reason saved.' : `${school.name} is suspended.`);
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to suspend the school.', fields: {} },
        });
      }
    },
  });
  return form;
}

type SuspensionForm = ReturnType<typeof useSuspensionForm>;

function ReasonField({ form }: { form: SuspensionForm }) {
  return (
    <form.Field name="reason">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="school-suspension-reason">Reason</Label>
          <Textarea
            id="school-suspension-reason"
            name={field.name}
            rows={3}
            maxLength={REASON_MAX_LENGTH}
            placeholder="What the school did, for other administrators"
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
            aria-invalid={field.state.meta.errors.length > 0}
          />
          <p className="text-xs text-muted-foreground">
            Only platform administrators see this. The school is told to contact support.
          </p>
          <ErrorLines errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

/**
 * Suspending a school: the reason, then an app confirmation that says what
 * suspension does. The dialog's open flag is UI state, not form state.
 */
function SuspendSchoolForm({ school }: { school: SchoolDto }) {
  const form = useSuspensionForm(school);
  const [confirming, setConfirming] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        // Asked only for a reason that will be accepted; an empty one shows its error instead.
        if (suspensionFormSchema.safeParse(form.state.values).success) setConfirming(true);
        else void form.handleSubmit();
      }}
    >
      <ReasonField form={form} />
      <form.Subscribe selector={(state) => ({ isSubmitting: state.isSubmitting, errors: state.errors })}>
        {({ isSubmitting, errors }) => (
          <div className="flex flex-col gap-3">
            <ErrorLines errors={errors} />
            <div className="flex justify-end">
              <Button type="submit" variant="destructive" disabled={isSubmitting}>
                {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {isSubmitting ? 'Suspending…' : 'Suspend school'}
              </Button>
            </div>
            <ConfirmationDialog
              open={confirming}
              title={`Suspend ${school.name}?`}
              description={SUSPEND_CONSEQUENCE}
              confirmLabel={isSubmitting ? 'Suspending…' : 'Suspend school'}
              pending={isSubmitting}
              onOpenChange={setConfirming}
              onConfirm={() => {
                // A failed save is shown on the card, so the dialog closes either way.
                void form.handleSubmit().finally(() => setConfirming(false));
              }}
            />
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

/** Lifting the suspension: one action, confirmed, with no input of its own. */
function LiftSuspensionButton({ school }: { school: SchoolDto }) {
  const storeSchool = useStoreSchool();
  const [confirming, setConfirming] = useState(false);
  const lift = useMutation(
    orpc.systemAdmin.unsuspendSchool.mutationOptions({
      onSuccess: (updated) => {
        storeSchool(updated);
        toast.success(`${school.name} is no longer suspended.`);
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Unable to lift the suspension.'),
      onSettled: () => setConfirming(false),
    }),
  );
  return (
    <>
      <Button type="button" variant="outline" disabled={lift.isPending} onClick={() => setConfirming(true)}>
        Lift suspension
      </Button>
      <ConfirmationDialog
        open={confirming}
        title={`Lift the suspension of ${school.name}?`}
        description="Staff and students of this school can change things again at once. The reason is cleared."
        confirmLabel={lift.isPending ? 'Lifting…' : 'Lift suspension'}
        confirmVariant="default"
        pending={lift.isPending}
        onOpenChange={setConfirming}
        onConfirm={() => lift.mutate({ id: school.id })}
      />
    </>
  );
}

/** A suspended school: since when, the reason (editable) and lifting it. */
function SuspendedSchoolForm({ school, suspendedAt }: { school: SchoolDto; suspendedAt: Date }) {
  const form = useSuspensionForm(school);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-sm">Suspended since {suspendedSince.format(suspendedAt)}. The school is read-only.</p>
      <ReasonField form={form} />
      <form.Subscribe selector={(state) => ({ isDirty: state.isDirty, isSubmitting: state.isSubmitting, errors: state.errors })}>
        {({ isDirty, isSubmitting, errors }) => (
          <div className="flex flex-col gap-3">
            <ErrorLines errors={errors} />
            <div className="flex flex-wrap justify-end gap-2">
              <LiftSuspensionButton school={school} />
              <Button type="submit" disabled={!isDirty || isSubmitting}>
                {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {isSubmitting ? 'Saving…' : 'Save reason'}
              </Button>
            </div>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

/**
 * Settings › Suspension: suspend a school that misuses the platform, or
 * lift it. A suspended school is read-only for its staff and students
 * (docs/school-suspension.md); platform administrators can still correct
 * its data. Each form is keyed by what is stored, so it restarts from the
 * saved state after every change.
 */
export function SchoolSuspensionCard({ school }: { school: SchoolDto }) {
  return (
    <Card className={school.suspendedAt ? 'ring-destructive/30' : undefined}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Suspension
          <SchoolSuspendedBadge suspendedAt={school.suspendedAt} />
        </CardTitle>
        <CardDescription>
          Suspend a school that misuses the platform. It becomes read-only: its staff and students still sign in and
          view everything, and nothing can be changed until you lift the suspension.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {school.suspendedAt ? (
          <SuspendedSchoolForm key={`suspended-${school.suspendedReason}`} school={school} suspendedAt={school.suspendedAt} />
        ) : (
          <SuspendSchoolForm key="active" school={school} />
        )}
      </CardContent>
    </Card>
  );
}
