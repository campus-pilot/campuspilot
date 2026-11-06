'use client';

import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_LOGO_MIME_TYPES } from '@campuspilot/api/routers/system-admin/school/school.constants';
import {
  SCHOOL_SLUG_PATTERN,
  slugifySchoolName,
} from '@campuspilot/api/workflows/demo-school/slug';
import { Button } from '@campuspilot/ui/components/button';
import { DialogFooter } from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { LoaderCircle } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import { uploadSchoolLogo } from '@/lib/school-image';
import {
  DemoClassPicker,
  DemoLogoField,
  FieldErrors,
  MonthSelect,
  type DemoClassOption,
} from './demo-school-fields';

export type CreatedDemoSchool = {
  jobId: string;
  schoolId: string;
  /** A non-blocking problem after the school was created (logo or start). */
  notice: string | null;
};

const demoSchoolFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter the school name.'),
  slug: z
    .string()
    .trim()
    .min(1, 'Enter a slug.')
    .regex(SCHOOL_SLUG_PATTERN, 'Use lowercase letters, numbers and single hyphens.'),
  slugEdited: z.boolean(),
  location: z.string().trim().min(1, 'Enter a location.'),
  registrationNo: z.string().trim().max(100, 'Use at most 100 characters.'),
  sessionStartYear: z.number({ message: 'Enter a year.' }).int().min(2000, 'Enter a year from 2000.').max(2100, 'Enter a year up to 2100.'),
  cycleStartMonth: z.string().regex(/^(?:[1-9]|1[0-2])$/, 'Choose a month.'),
  classSlugs: z.array(z.string()).min(1, 'Select at least one class.'),
  logo: z
    .instanceof(File)
    .refine((file) => SCHOOL_LOGO_MIME_TYPES.some((type) => type === file.type), {
      message: 'Choose a JPEG, PNG, or WebP image.',
    })
    .nullable(),
});

/** April-to-March sessions: before April the current session started last year. */
function currentSessionStartYear(today = new Date()) {
  return today.getMonth() + 1 >= 4 ? today.getFullYear() : today.getFullYear() - 1;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Creates the demo school (synchronously), uploads the optional logo through
 * the existing logo endpoint, then starts seeding. A logo or start failure
 * does not undo the school: the progress view reports it and offers a retry.
 */
function useDemoSchoolForm(catalogue: DemoClassOption[], onCreated: (created: CreatedDemoSchool) => void) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: {
      name: '',
      slug: '',
      slugEdited: false,
      location: 'Sample City',
      registrationNo: '',
      sessionStartYear: currentSessionStartYear(),
      cycleStartMonth: '4',
      classSlugs: catalogue.map((item) => item.slug),
      logo: null as File | null,
    },
    validators: { onSubmit: demoSchoolFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const { school, job } = await client.systemAdmin.createDemoSchool({
          name: value.name.trim(),
          slug: value.slug.trim(),
          location: value.location.trim(),
          registrationNo: value.registrationNo.trim() || undefined,
          sessionStartYear: value.sessionStartYear,
          sessionEndYear: value.sessionStartYear + 1,
          cycleStartMonth: Number(value.cycleStartMonth),
          // Catalogue order, which is also the order classes are created in.
          classSlugs: catalogue.map((item) => item.slug).filter((slug) => value.classSlugs.includes(slug)),
        });
        let notice: string | null = null;
        if (value.logo) {
          try {
            await uploadSchoolLogo(school.id, value.logo);
          } catch (error) {
            notice = `The logo was not uploaded (${errorMessage(error, 'upload failed')}); a generated monogram is used instead.`;
          }
        }
        try {
          await client.systemAdmin.startDemoSchoolJob({ jobId: job.id });
        } catch (error) {
          notice = `Seeding has not started: ${errorMessage(error, 'the workflow engine is unavailable')}. Use Start seeding to try again.`;
        }
        await queryClient.invalidateQueries({
          queryKey: orpc.systemAdmin.listSchools.queryKey({ input: {} }),
        });
        onCreated({ jobId: job.id, schoolId: school.id, notice });
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: errorMessage(error, 'Unable to create the demo school.'), fields: {} },
        });
      }
    },
  });
  return form;
}

export function DemoSchoolForm({
  catalogue,
  onCreated,
  onCancel,
}: {
  catalogue: DemoClassOption[];
  onCreated: (created: CreatedDemoSchool) => void;
  onCancel: () => void;
}) {
  const form = useDemoSchoolForm(catalogue, onCreated);

  return (
    <form
      className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="name">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-school-name">School name</Label>
              <Input
                id="demo-school-name"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  // The slug follows the name until the admin edits it.
                  if (!form.getFieldValue('slugEdited')) {
                    form.setFieldValue('slug', slugifySchoolName(event.target.value));
                  }
                }}
              />
              <FieldErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="slug">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-school-slug">Slug</Label>
              <Input
                id="demo-school-slug"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  form.setFieldValue('slugEdited', true);
                  field.handleChange(event.target.value);
                }}
              />
              <p className="text-xs text-muted-foreground">A -2, -3… suffix is added if it is taken.</p>
              <FieldErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="location">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-school-location">Location</Label>
              <Input id="demo-school-location" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
              <FieldErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="registrationNo">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-school-registration">Registration number</Label>
              <Input id="demo-school-registration" placeholder="Random 12 digits if blank" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
              <FieldErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="sessionStartYear">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-school-session">Session start year</Label>
              <Input
                id="demo-school-session"
                type="number"
                inputMode="numeric"
                value={Number.isNaN(field.state.value) ? '' : field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.valueAsNumber)}
              />
              <p className="text-xs text-muted-foreground">
                {Number.isNaN(field.state.value) ? 'One session.' : `One session: ${field.state.value}–${field.state.value + 1}.`}
              </p>
              <FieldErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="cycleStartMonth">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="demo-school-cycle">Billing cycle start</Label>
              <MonthSelect id="demo-school-cycle" value={field.state.value} onValueChange={field.handleChange} />
              <FieldErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
      </div>
      <form.Field name="classSlugs">
        {(field) => (
          <div className="flex flex-col gap-2">
            <DemoClassPicker catalogue={catalogue} value={field.state.value} onChange={field.handleChange} />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <form.Field name="logo">
            {(field) => (
              <div className="flex flex-col gap-2">
                <DemoLogoField value={field.state.value} disabled={isSubmitting} onBlur={field.handleBlur} onChange={field.handleChange} />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
        )}
      </form.Subscribe>
      <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting, errors: state.errors })}>
        {({ canSubmit, isSubmitting, errors }) => (
          <div className="flex flex-col gap-3">
            <FieldErrors errors={errors} />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {isSubmitting ? 'Creating…' : 'Create demo school'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
