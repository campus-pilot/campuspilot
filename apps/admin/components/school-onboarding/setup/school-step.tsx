'use client';

import { useQuery } from '@tanstack/react-query';
import { kebabSlug } from '@campuspilot/api/school-setup/school-setup.contract';
import { Button } from '@campuspilot/ui/components/button';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Textarea } from '@campuspilot/ui/components/textarea';
import { orpc } from '@/lib/orpc';
import { FieldRow, StepIntro } from './field-bits';
import type { SetupFormApi } from './setup-form';

type TextName = 'draft.school.name' | 'draft.school.location' | 'draft.school.registrationNo';

function TextField({ form, name, label, hint, multiline }: { form: SetupFormApi; name: TextName; label: string; hint?: string; multiline?: boolean }) {
  return (
    <form.Field name={name}>
      {(field) => (
        <FieldRow id={field.name} label={label} hint={hint} errors={field.state.meta.errors}>
          {multiline ? (
            <Textarea id={field.name} rows={3} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
          ) : (
            <Input id={field.name} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
          )}
        </FieldRow>
      )}
    </form.Field>
  );
}

/** The school's address in CampusPilot; "From name" fills it in from the name. */
function SlugField({ form }: { form: SetupFormApi }) {
  return (
    <form.Field name="draft.school.slug">
      {(field) => (
        <FieldRow id={field.name} label="Slug" hint="Lowercase letters, numbers and hyphens; must be unused." errors={field.state.meta.errors}>
          <div className="flex gap-2">
            <Input id={field.name} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
            <Button type="button" variant="outline" onClick={() => field.handleChange(kebabSlug(form.state.values.draft.school.name))}>
              From name
            </Button>
          </div>
        </FieldRow>
      )}
    </form.Field>
  );
}

/** The logo sent with the form, copied to the school when ticked; shown from a short-lived link. */
function LogoField({ form, requestId }: { form: SetupFormApi; requestId: string }) {
  const media = useQuery({ ...orpc.systemAdmin.getSchoolRegistrationRequestMedia.queryOptions({ input: { requestId } }), staleTime: 60_000 });
  return (
    <form.Field name="draft.school.useRequestLogo">
      {(field) => (
        <div className="flex items-center gap-3 rounded-lg border p-3">
          {media.data?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived presigned URL, not a static asset
            <img src={media.data.logoUrl} alt="Logo sent with the form" className="size-12 rounded-md border object-contain" />
          ) : null}
          <Checkbox id={field.name} checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked === true)} />
          <Label htmlFor={field.name}>Use the logo sent with the form</Label>
        </div>
      )}
    </form.Field>
  );
}

export function SchoolStep({ form, requestId, hasLogo }: { form: SetupFormApi; requestId: string; hasLogo: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <StepIntro title="School" description="The school's name, slug and address, as staff and documents will show them." />
      <TextField form={form} name="draft.school.name" label="School name" />
      <SlugField form={form} />
      <TextField form={form} name="draft.school.location" label="Address" hint="Printed on documents and question paper headers." multiline />
      <TextField form={form} name="draft.school.registrationNo" label="Registration number (optional)" />
      {hasLogo ? <LogoField form={form} requestId={requestId} /> : <p className="text-sm text-muted-foreground">No logo was sent with the form; add one later from the school&apos;s settings.</p>}
    </div>
  );
}
