'use client';

import { useForm } from '@tanstack/react-form';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import { Textarea } from '@campuspilot/ui/components/textarea';
import { z } from 'zod';

import { FormErrors } from './form-errors';
import type { AdmissionFormValue } from './types';

const admissionFormSchema = z.object({
  name: z.string().trim().min(1, 'Student name is required.').max(500),
  admissionNo: z.string().trim().min(1, 'Admission number is required.').max(500),
  admissionClassId: z.string().nullable(),
  address: z.string().trim().min(1, 'Address is required.').max(500),
  phoneNo: z.string().trim().min(1, 'Phone number is required.').max(500),
  email: z.union([z.literal(''), z.email('Enter a valid email address.')]),
  dob: z.iso.date('Enter a valid date of birth.'),
  fatherName: z.string().trim().min(1, "Father's name is required.").max(500),
  motherName: z.string().trim().min(1, "Mother's name is required.").max(500),
});

export function AdmissionFormDialog({ open, mode, defaultValues, classes, onOpenChange, onSubmit }: {
  open: boolean;
  mode: 'create' | 'edit';
  defaultValues: AdmissionFormValue;
  classes: Array<{ id: string; label: string }>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: AdmissionFormValue) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { ...defaultValues, email: defaultValues.email ?? '' },
    validators: { onSubmit: admissionFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const parsed = admissionFormSchema.parse(value);
        await onSubmit({ ...parsed, email: parsed.email || null });
        onOpenChange(false);
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: error instanceof Error ? error.message : 'Unable to save the admission.', fields: {} } });
      }
    },
  });
  const textFields = [
    ['name', 'Student name'], ['admissionNo', 'Admission number'], ['dob', 'Date of birth'],
    ['fatherName', "Father's name"], ['motherName', "Mother's name"], ['phoneNo', 'Phone number'], ['email', 'Email'],
  ] as const;

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{mode === 'create' ? 'Create admission' : 'Edit admission'}</DialogTitle><DialogDescription>Record personal and contact information. Documents are attached after the admission is saved.</DialogDescription></DialogHeader>
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
      {textFields.map(([name, label]) => <form.Field key={name} name={name}>{(field) => <div className="flex flex-col gap-2"><Label htmlFor={`admission-${name}`}>{label}</Label><Input id={`admission-${name}`} type={name === 'dob' ? 'date' : name === 'email' ? 'email' : 'text'} value={String(field.state.value ?? '')} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field>)}
      <form.Field name="admissionClassId">{(field) => <div className="flex flex-col gap-2"><Label>Admission class</Label><Select value={field.state.value ?? 'none'} onValueChange={(value) => field.handleChange(value === 'none' ? null : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not selected</SelectItem>{classes.map((schoolClass) => <SelectItem key={schoolClass.id} value={schoolClass.id}>{schoolClass.label}</SelectItem>)}</SelectContent></Select><FormErrors errors={field.state.meta.errors} /></div>}</form.Field>
      <form.Field name="address">{(field) => <div className="flex flex-col gap-2 sm:col-span-2"><Label htmlFor="admission-address">Address</Label><Textarea id="admission-address" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field>
      <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>{({ canSubmit, errors, isSubmitting }) => <div className="flex flex-col gap-3 sm:col-span-2"><FormErrors errors={errors} /><DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Saving…' : mode === 'create' ? 'Create admission' : 'Save changes'}</Button></DialogFooter></div>}</form.Subscribe>
    </form>
  </DialogContent></Dialog>;
}
