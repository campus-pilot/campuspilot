'use client';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { toast } from '@campuspilot/ui/lib/toast';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import type { PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { ExamButton, Issues, Notice } from './exam-common';
import { errorMessage } from './exam-model';

/** Consequential operations are deliberate form submissions; failed operations retain visible errors and never retry automatically. */
export function ExamCommand({
  permissions,
  label,
  explanation,
  run,
  destructive = false,
  onFailure,
}: {
  permissions: PermissionCheck | PermissionCheck[];
  label: string;
  explanation: string;
  run: () => Promise<unknown>;
  destructive?: boolean;
  onFailure?: () => Promise<unknown>;
}) {
  return (
    <RequirePermissions permissions={permissions}>
      <CommandForm
        label={label}
        explanation={explanation}
        run={run}
        destructive={destructive}
        onFailure={onFailure}
      />
    </RequirePermissions>
  );
}
function CommandForm({
  label,
  explanation,
  run,
  destructive,
  onFailure,
}: Omit<Parameters<typeof ExamCommand>[0], 'permissions'>) {
  const form = useForm({
    defaultValues: { confirming: false, message: '' },
    validators: {
      onSubmit: z.object({ confirming: z.boolean(), message: z.string() }),
    },
    onSubmit: async () => {
      try {
        await run();
        toast.success(`${label}: successful.`);
        form.reset();
        form.setFieldValue('message', `${label}: successful.`);
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: errorMessage(error), fields: {} },
        });
        await onFailure?.();
      }
    },
  });
  return (
    <form.Subscribe
      selector={(state) => ({
        ...state.values,
        pending: state.isSubmitting,
        canSubmit: state.canSubmit,
        errors: state.errors,
      })}
    >
      {({ confirming, message, pending, canSubmit, errors }) => (
        <div className="flex flex-col gap-2">
          <ExamButton
            variant={destructive ? 'destructive' : 'outline'}
            onClick={() => {
              form.setErrorMap({});
              form.setFieldValue('message', '');
              form.setFieldValue('confirming', true);
            }}
          >
            {label}
          </ExamButton>
          <ConfirmationDialog
            open={confirming}
            title={label}
            description={explanation}
            confirmLabel={pending ? 'Working…' : label}
            confirmVariant={destructive ? 'destructive' : 'default'}
            pending={pending}
            onOpenChange={(open) => form.setFieldValue('confirming', open)}
            onConfirm={() => {
              if (canSubmit && !pending) void form.handleSubmit();
            }}
          >
            <Issues errors={errors} />
          </ConfirmationDialog>
          {message && <Notice>{message}</Notice>}
        </div>
      )}
    </form.Subscribe>
  );
}
