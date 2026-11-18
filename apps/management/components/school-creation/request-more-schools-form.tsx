'use client';

import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { requestMoreSchoolsInputSchema } from '@campuspilot/api/routers/school-creation/school-creation.dto';
import { SCHOOL_REQUEST_REASON_MAX } from '@campuspilot/api/school-creation/school-creation.contract';
import { useState } from 'react';
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
import { FormErrors } from '@/components/form-errors';
import { client, orpc } from '@/lib/orpc';

function useRequestMoreSchoolsForm(currentLimit: number, onSent: () => void) {
  const queryClient = useQueryClient();
  return useForm({
    defaultValues: { requestedLimit: currentLimit + 1, reason: '' },
    validators: {
      onSubmit: requestMoreSchoolsInputSchema.refine(({ requestedLimit }) => requestedLimit > currentLimit, {
        message: `Ask for more than the ${currentLimit} you may create now.`,
        path: ['requestedLimit'],
      }),
    },
    onSubmit: async ({ value, formApi }) => {
      formApi.setErrorMap({});
      try {
        await client.schoolCreation.requestMore(value);
        await queryClient.invalidateQueries({ queryKey: orpc.schoolCreation.getStatus.key() });
        toast.success('Request sent. CampusPilot will get back to you.');
        onSent();
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to send the request.', fields: {} },
        });
      }
    },
  });
}

type RequestForm = ReturnType<typeof useRequestMoreSchoolsForm>;

function RequestedLimitField({ form }: { form: RequestForm }) {
  return (
    <form.Field name="requestedLimit">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="requested-school-limit">How many schools do you need in total?</Label>
          <Input
            id="requested-school-limit"
            type="number"
            inputMode="numeric"
            min={2}
            value={Number.isNaN(field.state.value) ? '' : field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.valueAsNumber)}
            aria-invalid={field.state.meta.errors.length > 0}
          />
          <FormErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function ReasonField({ form }: { form: RequestForm }) {
  return (
    <form.Field name="reason">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="requested-school-reason">Why do you need more schools?</Label>
          <Textarea
            id="requested-school-reason"
            rows={4}
            maxLength={SCHOOL_REQUEST_REASON_MAX}
            placeholder="For example: we run three branches of the same trust in Pune."
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
            aria-invalid={field.state.meta.errors.length > 0}
          />
          <FormErrors errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function RequestFooter({ form, onCancel }: { form: RequestForm; onCancel: () => void }) {
  return (
    <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
      {({ canSubmit, isSubmitting }) => (
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send request'}
          </Button>
        </DialogFooter>
      )}
    </form.Subscribe>
  );
}

function RequestMoreSchoolsDialogContent({ currentLimit, onClose }: { currentLimit: number; onClose: () => void }) {
  const form = useRequestMoreSchoolsForm(currentLimit, onClose);
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Ask for more schools</DialogTitle>
        <DialogDescription>CampusPilot reviews every request and gets back to you.</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <RequestedLimitField form={form} />
        <ReasonField form={form} />
        <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
          {(error) =>
            error && typeof error === 'object' && 'form' in error ? (
              <p role="alert" className="text-xs text-destructive">
                {String(error.form)}
              </p>
            ) : null
          }
        </form.Subscribe>
        <RequestFooter form={form} onCancel={onClose} />
      </form>
    </DialogContent>
  );
}

/**
 * Asks CampusPilot for a larger school allowance (docs/school-creation.md):
 * a button that opens the form for the total wanted and why. It reaches the
 * admin app's School requests page. The dialog's content mounts only while
 * it is open, so every opening starts from an empty form.
 */
export function RequestMoreSchoolsDialog({ currentLimit }: { currentLimit: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" onClick={() => setOpen(true)}>
        Ask for more schools
      </Button>
      {open ? <RequestMoreSchoolsDialogContent currentLimit={currentLimit} onClose={() => setOpen(false)} /> : null}
    </Dialog>
  );
}
