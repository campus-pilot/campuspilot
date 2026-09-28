'use client';

import { useState } from 'react';
import type { AdmissionDto } from '@campuspilot/api/routers/school/admission/admission.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AdmissionFormDialog, type AdmissionFormValue } from '@campuspilot/components/admission';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Pencil, UserRoundX } from 'lucide-react';
import { z } from 'zod';

import { client, orpc } from '@/lib/orpc';
import { FormErrors } from './form-errors';
import { RequirePermissions } from './require-permissions';

function EditAdmissionAction({ admission }: { admission: AdmissionDto }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const classesQuery = useQuery(orpc.school.listClasses.queryOptions({ input: { schoolId: admission.schoolId } }));
  const defaultValues: AdmissionFormValue = {
    name: admission.name,
    admissionNo: admission.admissionNo,
    admissionClassId: admission.admissionClassId,
    address: admission.address,
    phoneNo: admission.phoneNo,
    email: admission.email,
    dob: admission.dob,
    fatherName: admission.fatherName,
    motherName: admission.motherName,
  };
  return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.UPDATE_ADMISSION, resource: { kind: 'school', schoolId: admission.schoolId } }}>
    <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}><Pencil aria-hidden />Edit admission</Button>
    {open ? <AdmissionFormDialog open mode="edit" defaultValues={defaultValues} classes={(classesQuery.data ?? []).map(({ id, label }) => ({ id, label }))} onOpenChange={setOpen} onSubmit={async (value) => {
      await client.school.updateAdmission({ schoolId: admission.schoolId, admissionId: admission.id, ...value });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.school.getAdmission.queryKey({ input: { schoolId: admission.schoolId, admissionId: admission.id } }) }),
        queryClient.invalidateQueries({ queryKey: orpc.school.listAdmissions.queryKey({ input: { schoolId: admission.schoolId } }) }),
      ]);
    }} /> : null}
  </RequirePermissions>;
}

function UnregisterAdmissionAction({ admission }: { admission: AdmissionDto }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const confirmationSchema = z.object({
    confirmationName: z.string().trim().min(1, 'Enter the student name.'),
  }).refine(({ confirmationName }) => confirmationName === admission.name, {
    path: ['confirmationName'],
    message: 'The name must match exactly.',
  });
  const form = useForm({
    defaultValues: { confirmationName: '' },
    validators: { onSubmit: confirmationSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const parsed = confirmationSchema.parse(value);
        await client.school.unregisterAdmission({
          schoolId: admission.schoolId,
          admissionId: admission.id,
          confirmationName: parsed.confirmationName,
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.school.getAdmission.queryKey({ input: { schoolId: admission.schoolId, admissionId: admission.id } }) }),
          queryClient.invalidateQueries({ queryKey: orpc.school.listAdmissions.queryKey({ input: { schoolId: admission.schoolId } }) }),
        ]);
        setOpen(false);
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: error instanceof Error ? error.message : 'Unable to unregister this admission.', fields: {} } });
      }
    },
  });
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) form.reset();
    setOpen(nextOpen);
  }
  return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.UNREGISTER_ADMISSION, resource: { kind: 'school', schoolId: admission.schoolId } }}>
    <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}><UserRoundX aria-hidden />Unregister</Button>
    <Dialog open={open} onOpenChange={handleOpenChange}><DialogContent><DialogHeader><DialogTitle>Unregister {admission.name}?</DialogTitle><DialogDescription>This permanently ends the admission's association with the school. It cannot be registered again; returning students need a new admission.</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><form.Field name="confirmationName">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="unregister-admission-name">Type <span className="font-semibold text-foreground">{admission.name}</span> to confirm</Label><Input id="unregister-admission-name" autoComplete="off" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>{({ canSubmit, errors, isSubmitting }) => <div className="flex flex-col gap-3"><FormErrors errors={errors} /><DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={() => handleOpenChange(false)}>Cancel</Button><Button type="submit" variant="destructive" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Unregistering…' : 'Unregister admission'}</Button></DialogFooter></div>}</form.Subscribe></form></DialogContent></Dialog>
  </RequirePermissions>;
}

export function AdmissionActions({ admission }: { admission: AdmissionDto }) {
  if (!admission.registered) return null;
  return <div className="flex flex-wrap items-center gap-2"><EditAdmissionAction admission={admission} /><UnregisterAdmissionAction admission={admission} /></div>;
}
