'use client';

import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createOwnSchoolInputSchema } from '@campuspilot/api/routers/school-creation/school-creation.dto';
import { BILLING_PERIOD_DAYS } from '@campuspilot/api/billing/billing.contract';
import {
  SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD,
} from '@campuspilot/api/school-creation/school-creation.contract';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { z } from 'zod';
import { FormErrors } from '@/components/form-errors';
import { client, orpc } from '@/lib/orpc';
import { schoolHref } from '../school-route';
import { storeSchoolId } from '../school-selection';

const createSchoolFormSchema = z.object({
  name: createOwnSchoolInputSchema.shape.name,
  location: createOwnSchoolInputSchema.shape.location,
  registrationNo: z.string().trim().max(60),
});

type TextFieldName = keyof z.infer<typeof createSchoolFormSchema>;

/** Creates the school, refreshes what depends on it and opens it. */
function useCreateSchoolForm() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useForm({
    defaultValues: { name: '', location: '', registrationNo: '' },
    validators: { onSubmit: createSchoolFormSchema },
    onSubmit: async ({ value, formApi }) => {
      formApi.setErrorMap({});
      try {
        const { schoolId } = await client.schoolCreation.createSchool({
          name: value.name,
          location: value.location,
          registrationNo: value.registrationNo || null,
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.school.listMySchools.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.schoolCreation.getStatus.key() }),
        ]);
        storeSchoolId(schoolId);
        router.push(schoolHref(schoolId));
      } catch (error) {
        // A refusal (for example the allowance used up in another tab) is
        // shown here; the status query is read again so the screen follows.
        void queryClient.invalidateQueries({ queryKey: orpc.schoolCreation.getStatus.key() });
        formApi.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to create the school.', fields: {} },
        });
      }
    },
  });
}

type CreateSchoolForm = ReturnType<typeof useCreateSchoolForm>;

function TextField({
  form,
  name,
  label,
  placeholder,
}: {
  form: CreateSchoolForm;
  name: TextFieldName;
  label: string;
  placeholder: string;
}) {
  return (
    <form.Field name={name}>
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`create-school-${name}`}>{label}</Label>
          <Input
            id={`create-school-${name}`}
            placeholder={placeholder}
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

/**
 * The person's own school: name, location and an optional registration
 * number. The school starts on a trial (docs/school-creation.md), which is
 * said before it is created, with how many schools the person may still
 * create (their allowance, which an approved request raises).
 */
export function CreateSchoolForm({ limit, used }: { limit: number; used: number }) {
  const form = useCreateSchoolForm();
  const left = limit - used;
  return (
    <form
      className="flex flex-col gap-4 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <TextField form={form} name="name" label="School name" placeholder="Sunrise Public School" />
      <TextField form={form} name="location" label="Location" placeholder="City, state" />
      <TextField form={form} name="registrationNo" label="Registration number (optional)" placeholder="As issued by the board" />
      <p className="text-xs leading-5 text-muted-foreground">
        You become the school&apos;s owner and principal. It starts with a free {BILLING_PERIOD_DAYS}-day trial of
        the Plus plan (staff, classes and examinations) and the AI assistant up to $
        {SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD} per {BILLING_PERIOD_DAYS} days. Your billing cycle starts today:
        when the trial ends the school becomes read-only until the next period is paid.{' '}
        {left === 1 ? 'This uses the last school your account may create.' : `You may create ${left} more schools.`}
      </p>
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(error) =>
          error && typeof error === 'object' && 'form' in error ? (
            <p className="text-xs text-destructive">{String(error.form)}</p>
          ) : null
        }
      </form.Subscribe>
      <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
        {({ canSubmit, isSubmitting }) => (
          <Button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create school'}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
