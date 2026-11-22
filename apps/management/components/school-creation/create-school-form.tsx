'use client';

import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createOwnSchoolInputSchema } from '@campuspilot/api/routers/school-creation/school-creation.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { z } from 'zod';
import { FormErrors } from '@/components/form-errors';
import { client, orpc } from '@/lib/orpc';
import { storeSchoolId } from '../school-selection';
import { onboardingHref } from '../school-onboarding/onboarding-route';

const createSchoolFormSchema = z.object({
  name: createOwnSchoolInputSchema.shape.name,
  location: createOwnSchoolInputSchema.shape.location,
  registrationNo: z.string().trim().max(60),
});

type TextFieldName = 'name' | 'location' | 'registrationNo';

/**
 * Creates the school and opens its guided setup (docs/school-creation.md).
 * Only what a question paper's header prints is asked here; the logo is
 * asked on the guide's paper header screen, where the person sees the header
 * it belongs to.
 */
function useCreateSchoolForm() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useForm({
    defaultValues: { name: '', location: '', registrationNo: '' },
    validators: { onSubmit: createSchoolFormSchema },
    onSubmit: async ({ value, formApi }) => {
      let schoolId: string;
      try {
        ({ schoolId } = await client.schoolCreation.createSchool({
          name: value.name,
          location: value.location,
          registrationNo: value.registrationNo || null,
        }));
      } catch (error) {
        // A refusal (for example the allowance used up in another tab) is
        // shown here; the status query is read again so the screen follows.
        void queryClient.invalidateQueries({ queryKey: orpc.schoolCreation.getStatus.key() });
        formApi.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to create the school.', fields: {} },
        });
        return;
      }
      await Promise.all([
        // `all`: the list is read again even where no screen shows it now (this page sits outside a school), so the
        // new school's access check finds it instead of the cached list without it, which would send the person to
        // their personal space or the school picker instead.
        queryClient.invalidateQueries({ queryKey: orpc.school.listMySchools.key(), refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: orpc.schoolCreation.getStatus.key() }),
      ]);
      storeSchoolId(schoolId);
      router.push(onboardingHref(schoolId));
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

function SubmitError({ form }: { form: CreateSchoolForm }) {
  return (
    <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
      {(error) =>
        error && typeof error === 'object' && 'form' in error ? (
          <p role="alert" className="text-xs text-destructive">
            {String(error.form)}
          </p>
        ) : null
      }
    </form.Subscribe>
  );
}

function SubmitButton({ form }: { form: CreateSchoolForm }) {
  return (
    <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
      {({ canSubmit, isSubmitting }) => (
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? 'Creating your school…' : 'Start free trial'}
        </Button>
      )}
    </form.Subscribe>
  );
}

/**
 * The create-school form, on the page itself: name, location and an optional
 * registration number, the details every question paper header prints. The
 * school opens straight into its guided setup, whose first screen tells what
 * the trial gives.
 */
export function CreateSchoolForm() {
  const form = useCreateSchoolForm();
  return (
    <form
      className="flex flex-col gap-4 rounded-xl border bg-card p-5 text-left shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <TextField form={form} name="name" label="School name" placeholder="Sunrise Public School" />
      <TextField form={form} name="location" label="Town or city" placeholder="City, state" />
      <TextField form={form} name="registrationNo" label="Registration number (optional)" placeholder="As issued by the board" />
      <SubmitError form={form} />
      <SubmitButton form={form} />
    </form>
  );
}
