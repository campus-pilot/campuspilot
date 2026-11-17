'use client';

import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { SchoolCreationRequestDto } from '@campuspilot/api/routers/system-admin/school-creation-request/school-creation-request.dto';
import { MAX_GRANTED_SCHOOL_LIMIT } from '@campuspilot/api/school-creation/school-creation.contract';
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
import { Textarea } from '@campuspilot/ui/components/textarea';
import { toast } from '@campuspilot/ui/lib/toast';
import { client, orpc } from '@/lib/orpc';
import { FieldErrors } from '../users/field-errors';

export type SchoolRequestDecision = 'approve' | 'reject';

const decisionFormSchema = z.object({
  grantedLimit: z
    .number({ message: 'Enter a number.' })
    .int('Enter a whole number.')
    .min(1)
    .max(MAX_GRANTED_SCHOOL_LIMIT, `At most ${MAX_GRANTED_SCHOOL_LIMIT}.`),
  note: z.string().trim().max(1000),
});

function personLabel(request: SchoolCreationRequestDto) {
  return request.name.trim() || staffSignInLabel(request);
}

function useDecisionForm(request: SchoolCreationRequestDto, decision: SchoolRequestDecision, onDone: () => void) {
  const queryClient = useQueryClient();
  return useForm({
    defaultValues: { grantedLimit: request.requestedLimit, note: '' },
    validators: { onSubmit: decisionFormSchema },
    onSubmit: async ({ value, formApi }) => {
      formApi.setErrorMap({});
      try {
        await client.systemAdmin.decideSchoolCreationRequest(
          decision === 'approve'
            ? { id: request.id, decision, grantedLimit: value.grantedLimit, note: value.note || undefined }
            : { id: request.id, decision, note: value.note || undefined },
        );
        void queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSchoolCreationRequests.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.countPendingSchoolCreationRequests.key() });
        toast.success(
          decision === 'approve'
            ? `${personLabel(request)} may now create ${value.grantedLimit} schools.`
            : 'Request rejected.',
        );
        onDone();
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to save the decision.', fields: {} },
        });
      }
    },
  });
}

type DecisionForm = ReturnType<typeof useDecisionForm>;

function GrantedLimitField({ form, used }: { form: DecisionForm; used: number }) {
  return (
    <form.Field name="grantedLimit">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="granted-limit">Schools they may create in total</Label>
          <Input
            id="granted-limit"
            type="number"
            inputMode="numeric"
            min={used + 1}
            max={MAX_GRANTED_SCHOOL_LIMIT}
            value={Number.isNaN(field.state.value) ? '' : field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.valueAsNumber)}
          />
          <p className="text-xs text-muted-foreground">
            They created {used} so far, including deleted ones; grant more than that.
          </p>
          <FieldErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function NoteField({ form }: { form: DecisionForm }) {
  return (
    <form.Field name="note">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="decision-note">Note to them (optional)</Label>
          <Textarea
            id="decision-note"
            rows={3}
            maxLength={1000}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
          <FieldErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

/**
 * Approves a request (setting the person's allowance, which may differ from
 * what they asked) or rejects it, each with an optional note the person sees
 * in management. Mounted per request and decision, so it opens clean.
 */
export function DecideSchoolRequestDialog({
  request,
  decision,
  onClose,
}: {
  request: SchoolCreationRequestDto;
  decision: SchoolRequestDecision;
  onClose: () => void;
}) {
  const form = useDecisionForm(request, decision, onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && !form.state.isSubmitting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{decision === 'approve' ? 'Approve request' : 'Reject request'}</DialogTitle>
          <DialogDescription>
            {personLabel(request)} asked to create up to {request.requestedLimit} schools (allowed now:{' '}
            {request.currentLimit}).
          </DialogDescription>
        </DialogHeader>
        <form
          id="decide-school-request"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          {decision === 'approve' ? <GrantedLimitField form={form} used={request.createdSchools.length} /> : null}
          <NoteField form={form} />
          <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
            {(error) =>
              error && typeof error === 'object' && 'form' in error ? (
                <p className="text-xs text-destructive">{String(error.form)}</p>
              ) : null
            }
          </form.Subscribe>
        </form>
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="decide-school-request"
                variant={decision === 'reject' ? 'destructive' : 'default'}
                disabled={!canSubmit || isSubmitting}
              >
                {decision === 'approve' ? 'Approve' : 'Reject'}
              </Button>
            </DialogFooter>
          )}
        </form.Subscribe>
      </DialogContent>
    </Dialog>
  );
}
