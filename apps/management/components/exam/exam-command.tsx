'use client';
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
        form.reset({ confirming: false, message: `${label}: successful.` });
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: errorMessage(error), fields: {} },
        });
        await onFailure?.();
      }
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex flex-col gap-2"
    >
      <form.Subscribe
        selector={(state) => ({
          ...state.values,
          isSubmitting: state.isSubmitting,
          errors: state.errors,
        })}
      >
        {({ confirming, message, isSubmitting, errors }) => (
          <>
            {confirming ? (
              <>
                <Notice>{explanation}</Notice>
                <div className="flex flex-wrap gap-3">
                  <ExamButton
                    type="submit"
                    variant={destructive ? 'destructive' : 'default'}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Working…' : label}
                  </ExamButton>
                  <ExamButton
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={() => form.setFieldValue('confirming', false)}
                  >
                    Cancel
                  </ExamButton>
                </div>
              </>
            ) : (
              <ExamButton
                type="button"
                variant={destructive ? 'destructive' : 'outline'}
                onClick={() => {
                  form.setErrorMap({});
                  form.setFieldValue('message', '');
                  form.setFieldValue('confirming', true);
                }}
              >
                {label}
              </ExamButton>
            )}
            {message && <Notice>{message}</Notice>}
            <Issues errors={errors} />
          </>
        )}
      </form.Subscribe>
    </form>
  );
}
