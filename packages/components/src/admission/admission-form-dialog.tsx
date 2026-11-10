'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Button } from '@campuspilot/ui/components/button';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import { Textarea } from '@campuspilot/ui/components/textarea';
import { z } from 'zod';

import {
  PhoneInput,
  phoneInputValueFromStored,
  phoneInputValueSchema,
  phoneInputValueToE164,
  requiredPhoneInputSchema,
} from '../phone-input';
import { FormErrors } from './form-errors';
import type { AdmissionFormSubmitValue, AdmissionFormValue } from './types';

/** Personal details of the admission. */
const detailsSchema = z.object({
  name: z.string().trim().min(1, 'Student name is required.').max(500),
  admissionNo: z.string().trim().min(1, 'Admission number is required.').max(500),
  admissionClassId: z.string().nullable(),
  address: z.string().trim().min(1, 'Address is required.').max(500),
  email: z.union([z.literal(''), z.email('Enter a valid email address.')]),
  dob: z.iso.date('Enter a valid date of birth.'),
  fatherName: z.string().trim().min(1, "Father's name is required.").max(500),
  motherName: z.string().trim().min(1, "Mother's name is required.").max(500),
});

/**
 * Contact and WhatsApp choices (D-4, D-8). While "same as phone" is ticked
 * the WhatsApp number is the phone number; otherwise staff type the WhatsApp
 * number (optional). "Verified" is always its own field: ticking "same as
 * phone" only pre-ticks it (D-4 "verified by default"), staff can untick it,
 * and the submitted value is exactly the field value.
 */
const contactSchema = z
  .object({
    phone: requiredPhoneInputSchema('Phone number is required.'),
    whatsappSameAsPhone: z.boolean(),
    whatsapp: phoneInputValueSchema,
    whatsappVerified: z.boolean(),
    whatsappConsent: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.whatsappSameAsPhone) return;
    const typed = value.whatsapp.number.trim();
    if (typed && !phoneInputValueToE164(value.whatsapp)) {
      context.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Enter a valid WhatsApp number for the selected country.' });
    }
    if (!typed && value.whatsappVerified) {
      context.addIssue({ code: 'custom', path: ['whatsappVerified'], message: 'Enter the WhatsApp number before marking it verified.' });
    }
  });

const dialogSchema = detailsSchema.and(contactSchema).and(z.object({ generateCadetPassword: z.boolean() }));

type DialogValues = z.input<typeof dialogSchema>;

/** Choices made in the dialog that are not admission fields. */
export type AdmissionFormOptions = {
  /** Also issue a Cadet Portal password (create mode only). */
  generateCadetPassword: boolean;
};

/** Dialog field values for stored admission values. */
function toDialogValues(value: AdmissionFormValue): DialogValues {
  return {
    name: value.name,
    admissionNo: value.admissionNo,
    admissionClassId: value.admissionClassId,
    address: value.address,
    email: value.email ?? '',
    dob: value.dob,
    fatherName: value.fatherName,
    motherName: value.motherName,
    phone: phoneInputValueFromStored(value.phoneNo),
    // Checked by default in the form only (D-4); a recorded choice wins.
    whatsappSameAsPhone: value.whatsappSameAsPhone ?? true,
    whatsapp: phoneInputValueFromStored(value.whatsappNo),
    whatsappVerified: value.whatsappVerified,
    whatsappConsent: value.whatsappConsent,
    generateCadetPassword: false,
  };
}

/** The submitted admission: E.164 numbers, the WhatsApp number resolved from the choice. */
function toSubmitValue(value: z.output<typeof dialogSchema>): AdmissionFormSubmitValue {
  const whatsappNo = value.whatsappSameAsPhone
    ? value.phone
    : phoneInputValueToE164(value.whatsapp);
  return {
    name: value.name,
    admissionNo: value.admissionNo,
    admissionClassId: value.admissionClassId,
    address: value.address,
    email: value.email || null,
    dob: value.dob,
    fatherName: value.fatherName,
    motherName: value.motherName,
    phoneNo: value.phone,
    whatsappSameAsPhone: value.whatsappSameAsPhone,
    whatsappNo,
    // The field value as shown; never forced by "same as phone" (an edited
    // backfilled row keeps its stored "not verified" unless staff tick it).
    whatsappVerified: value.whatsappVerified && whatsappNo !== null,
    whatsappConsent: value.whatsappConsent,
  };
}

/** The admission dialog's form: one TanStack Form for every field. */
function useAdmissionForm({ defaultValues, showCadetPasswordOption, onSubmit, onSaved }: {
  defaultValues: AdmissionFormValue;
  showCadetPasswordOption: boolean;
  onSubmit: (value: AdmissionFormSubmitValue, options: AdmissionFormOptions) => Promise<void>;
  onSaved: () => void;
}) {
  const form = useForm({
    defaultValues: toDialogValues(defaultValues),
    validators: { onSubmit: dialogSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const parsed = dialogSchema.parse(value);
        await onSubmit(toSubmitValue(parsed), {
          generateCadetPassword: showCadetPasswordOption && parsed.generateCadetPassword,
        });
        onSaved();
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: error instanceof Error ? error.message : 'Unable to save the admission.', fields: {} } });
      }
    },
  });
  return form;
}

type AdmissionForm = ReturnType<typeof useAdmissionForm>;

const TEXT_FIELDS = [
  ['name', 'Student name'], ['admissionNo', 'Admission number'], ['dob', 'Date of birth'],
  ['fatherName', "Father's name"], ['motherName', "Mother's name"], ['email', 'Email'],
] as const;

/** Name, numbers, family, class and address. */
function AdmissionDetailsFields({ form, classes }: { form: AdmissionForm; classes: Array<{ id: string; label: string }> }) {
  return <>
    {TEXT_FIELDS.map(([name, label]) => <form.Field key={name} name={name}>{(field) => <div className="flex flex-col gap-2"><Label htmlFor={`admission-${name}`}>{label}</Label><Input id={`admission-${name}`} type={name === 'dob' ? 'date' : name === 'email' ? 'email' : 'text'} value={String(field.state.value ?? '')} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field>)}
    <form.Field name="admissionClassId">{(field) => <div className="flex flex-col gap-2"><Label>Admission class</Label><Select value={field.state.value ?? 'none'} onValueChange={(value) => field.handleChange(value === 'none' ? null : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not selected</SelectItem>{classes.map((schoolClass) => <SelectItem key={schoolClass.id} value={schoolClass.id}>{schoolClass.label}</SelectItem>)}</SelectContent></Select><FormErrors errors={field.state.meta.errors} /></div>}</form.Field>
    <form.Field name="address">{(field) => <div className="flex flex-col gap-2 sm:col-span-2"><Label htmlFor="admission-address">Address</Label><Textarea id="admission-address" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field>
  </>;
}

/** A labelled checkbox with an optional hint. */
function CheckboxRow({ id, label, hint, checked, disabled, onCheckedChange }: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return <div className="flex items-start gap-2 sm:col-span-2"><Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(next) => onCheckedChange(next === true)} /><div className="flex flex-col gap-1"><Label htmlFor={id} className="font-normal">{label}</Label>{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</div></div>;
}

/** The WhatsApp number: the phone number (locked) while "same as phone" is ticked. */
function WhatsappNumberField({ form }: { form: AdmissionForm }) {
  return <form.Subscribe selector={(state) => ({ same: state.values.whatsappSameAsPhone, phone: state.values.phone })}>{({ same, phone }) => <form.Field name="whatsapp">{(field) => <div className="flex flex-col gap-2 sm:col-span-2"><Label htmlFor="admission-whatsapp">WhatsApp number</Label><PhoneInput id="admission-whatsapp" value={same ? phone : field.state.value} disabled={same} invalid={field.state.meta.errors.length > 0} onBlur={field.handleBlur} onChange={field.handleChange} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field>}</form.Subscribe>;
}

/**
 * "WhatsApp number is the same as phone number". Ticking it also pre-ticks
 * "verified" (D-4: staff asked the guardian, so verified is the default);
 * unticking clears it, because the WhatsApp number staff now type is a
 * different number nobody has verified yet. Done in the change handler, so
 * a stored choice loaded for editing never changes "verified" by itself.
 */
function SameAsPhoneField({ form }: { form: AdmissionForm }) {
  return <form.Field name="whatsappSameAsPhone">{(field) => <CheckboxRow id="admission-whatsapp-same" label="WhatsApp number is the same as phone number" checked={field.state.value} onCheckedChange={(checked) => { field.handleChange(checked); form.setFieldValue('whatsappVerified', checked); }} />}</form.Field>;
}

/** Phone number and WhatsApp choices (D-4, D-8). */
function AdmissionContactFields({ form }: { form: AdmissionForm }) {
  return <>
    <form.Field name="phone">{(field) => <div className="flex flex-col gap-2 sm:col-span-2"><Label htmlFor="admission-phone">Phone number</Label><PhoneInput id="admission-phone" value={field.state.value} invalid={field.state.meta.errors.length > 0} onBlur={field.handleBlur} onChange={field.handleChange} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field>
    <SameAsPhoneField form={form} />
    <WhatsappNumberField form={form} />
    <form.Field name="whatsappVerified">{(field) => <div className="flex flex-col gap-1 sm:col-span-2"><CheckboxRow id="admission-whatsapp-verified" label="WhatsApp number verified" hint="Tick once the guardian confirmed this WhatsApp number." checked={field.state.value} onCheckedChange={field.handleChange} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field>
    <form.Field name="whatsappConsent">{(field) => <CheckboxRow id="admission-whatsapp-consent" label="Guardian consented to WhatsApp notifications" hint="Bills, receipts and results are sent on WhatsApp only with consent. Untick to stop them." checked={field.state.value} onCheckedChange={field.handleChange} />}</form.Field>
  </>;
}

/** The dialog's steps, in order (D-8b). */
const STEPS = [
  { id: 'details', title: 'Details', description: 'Personal and family information. Documents are attached after the admission is saved.' },
  { id: 'contact', title: 'Contact & notifications', description: 'Phone number, WhatsApp number and consent for WhatsApp notifications.' },
] as const;

type StepIndex = 0 | 1;

/** Field errors keyed by field name, from a failed step validation. */
function fieldErrors(error: z.ZodError) {
  return Object.fromEntries(error.issues.map((issue) => [issue.path.join('.'), issue.message]));
}

/** "Step 1 of 2" with the step title, announced to assistive technology. */
function StepIndicator({ step }: { step: StepIndex }) {
  return <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Steps">{STEPS.map((item, index) => <li key={item.id} aria-current={index === step ? 'step' : undefined} className={index === step ? 'font-medium text-foreground' : 'text-muted-foreground'}>{`${index + 1}. ${item.title}`}</li>)}</ol>;
}

/** Cancel/Back and Next/Save, with the form's errors and submission progress. */
function StepFooter({ form, step, mode, onBack, onCancel }: {
  form: AdmissionForm;
  step: StepIndex;
  mode: 'create' | 'edit';
  onBack: () => void;
  onCancel: () => void;
}) {
  const last = step === STEPS.length - 1;
  const saveLabel = mode === 'create' ? 'Create admission' : 'Save changes';
  return <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>{({ canSubmit, errors, isSubmitting }) => <div className="flex flex-col gap-3 sm:col-span-2"><FormErrors errors={errors} /><DialogFooter>{step === 0 ? <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button> : <Button type="button" variant="outline" disabled={isSubmitting} onClick={onBack}>Back</Button>}<Button type="submit" disabled={last && (!canSubmit || isSubmitting)}>{last ? (isSubmitting ? 'Saving…' : saveLabel) : 'Next'}</Button></DialogFooter></div>}</form.Subscribe>;
}

/**
 * Create or edit an admission in two steps (D-8b): details, then contact &
 * notifications. One TanStack Form holds every field across both steps, so
 * going back and forth keeps what was typed. "Next" validates only the
 * details step; saving validates everything. In create mode "WhatsApp number
 * is the same as phone number" starts checked (D-4).
 *
 * `cadetPasswordOption` shows the "Generate Cadet Portal password" checkbox
 * (unchecked by default) in create mode; the caller passes it only when the
 * user may issue Cadet Portal passwords.
 */
export function AdmissionFormDialog({ open, mode, defaultValues, classes, cadetPasswordOption = false, onOpenChange, onSubmit }: {
  open: boolean;
  mode: 'create' | 'edit';
  defaultValues: AdmissionFormValue;
  classes: Array<{ id: string; label: string }>;
  cadetPasswordOption?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: AdmissionFormSubmitValue, options: AdmissionFormOptions) => Promise<void>;
}) {
  const showCadetPasswordOption = mode === 'create' && cadetPasswordOption;
  const [step, setStep] = useState<StepIndex>(0);
  const form = useAdmissionForm({ defaultValues, showCadetPasswordOption, onSubmit, onSaved: () => onOpenChange(false) });

  /** Validates the details step only, then moves to contact & notifications. */
  function next() {
    const parsed = detailsSchema.safeParse(form.state.values);
    if (!parsed.success) {
      form.setErrorMap({ onSubmit: { fields: fieldErrors(parsed.error), form: undefined } });
      return;
    }
    form.setErrorMap({ onSubmit: { fields: {}, form: undefined } });
    setStep(1);
  }

  const current = STEPS[step];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{mode === 'create' ? 'Create admission' : 'Edit admission'}</DialogTitle><DialogDescription>{current.description}</DialogDescription><StepIndicator step={step} /></DialogHeader>
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); if (step === 0) next(); else void form.handleSubmit(); }}>
      {step === 0 ? <AdmissionDetailsFields form={form} classes={classes} /> : <AdmissionContactFields form={form} />}
      {step === 1 && showCadetPasswordOption ? <form.Field name="generateCadetPassword">{(field) => <CheckboxRow id="admission-generate-cadet-password" label="Generate Cadet Portal password" hint="The student can sign in to the Cadet Portal with it. It is shown once after the admission is created." checked={field.state.value} onCheckedChange={field.handleChange} />}</form.Field> : null}
      <StepFooter form={form} step={step} mode={mode} onBack={() => setStep(0)} onCancel={() => onOpenChange(false)} />
    </form>
  </DialogContent></Dialog>;
}
