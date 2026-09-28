'use client';

import { useForm } from '@tanstack/react-form';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { FileText, Info, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';

import { FormErrors } from './form-errors';
import type { AdmissionDocumentType } from './types';

const settingsSchema = z.object({
  documentTypes: z
    .array(z.object({
      label: z.string().trim().min(1, 'Document name is required.').max(200),
      value: z.string().trim().min(1, 'Document key is required.').max(100)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens.'),
    }))
    .max(10, 'A school can configure at most 10 document types.')
    .refine((types) => new Set(types.map(({ value }) => value)).size === types.length, 'Document keys must be unique.'),
});

function FieldLabel({ htmlFor, children, help }: { htmlFor: string; children: string; help: string }) {
  return <div className="flex items-center gap-1.5"><Label htmlFor={htmlFor}>{children}</Label><Tooltip><TooltipTrigger asChild><button type="button" className="text-muted-foreground" aria-label={`About ${children}`}><Info className="size-3.5" aria-hidden /></button></TooltipTrigger><TooltipContent>{help}</TooltipContent></Tooltip></div>;
}

export function AdmissionDocumentSettings({
  documentTypes,
  canEdit,
  onSave,
}: {
  documentTypes: AdmissionDocumentType[];
  canEdit: boolean;
  onSave: (documentTypes: AdmissionDocumentType[]) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { documentTypes },
    validators: { onSubmit: settingsSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        await onSave(settingsSchema.parse(value).documentTypes);
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: error instanceof Error ? error.message : 'Unable to save document settings.', fields: {} } });
      }
    },
  });

  return (
    <form
      className="flex max-w-3xl flex-col gap-5 rounded-xl border bg-card p-5"
      onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FileText className="size-5" aria-hidden /></span>
        <div>
          <h2 className="font-semibold">Admission documents</h2>
          <p className="text-sm text-muted-foreground">List the documents staff should request from families. The list is advisory and does not block admission creation.</p>
        </div>
      </div>
      <form.Field name="documentTypes" mode="array">
        {(typesField) => (
          <div className="flex flex-col gap-4">
            {typesField.state.value.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No requested documents configured.</div>
            ) : null}
            {typesField.state.value.map((type, index) => (
              <div key={index} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
                <form.Field name={`documentTypes[${index}].label`}>
                  {(field) => <div className="flex flex-col gap-2"><FieldLabel htmlFor={`document-label-${index}`} help="The human-readable name staff see when collecting this document.">Document name</FieldLabel><Input id={`document-label-${index}`} value={field.state.value} disabled={!canEdit} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FormErrors errors={field.state.meta.errors} /></div>}
                </form.Field>
                <form.Field name={`documentTypes[${index}].value`}>
                  {(field) => <div className="flex flex-col gap-2"><FieldLabel htmlFor={`document-key-${index}`} help="A permanent machine-readable identifier. Keep it unchanged after documents use this type.">Stable key</FieldLabel><Input id={`document-key-${index}`} value={field.state.value} disabled={!canEdit} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FormErrors errors={field.state.meta.errors} /></div>}
                </form.Field>
                {canEdit ? <Button type="button" variant="ghost" size="icon-sm" className="sm:mt-7" aria-label={`Remove ${type.label || 'document type'}`} onClick={() => typesField.removeValue(index)}><Trash2 aria-hidden /></Button> : null}
              </div>
            ))}
            {canEdit ? <Button type="button" variant="outline" className="self-start" disabled={typesField.state.value.length >= 10} onClick={() => typesField.pushValue({ label: '', value: '' })}><Plus aria-hidden />Add document type</Button> : null}
          </div>
        )}
      </form.Field>
      {canEdit ? (
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isDirty: state.isDirty, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, errors, isDirty, isSubmitting }) => <div className="flex flex-col items-start gap-3"><FormErrors errors={errors} /><Button type="submit" disabled={!canSubmit || !isDirty || isSubmitting}>{isSubmitting ? 'Saving…' : 'Save document settings'}</Button></div>}
        </form.Subscribe>
      ) : null}
    </form>
  );
}
