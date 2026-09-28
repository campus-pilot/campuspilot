'use client';

import { useState } from 'react';
import { CLASS_ACTIONS, SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@campuspilot/ui/components/combobox';
import { Plus } from 'lucide-react';
import { z } from 'zod';

import { client, orpc } from '@/lib/orpc';
import { FormErrors } from './form-errors';

const enrollmentSchema = z.object({ admissionId: z.string().min(1, 'Select an admission.'), admissionSearch: z.string(), sectionId: z.string().min(1, 'Select a section.'), rollNo: z.number().int().positive('Enter a positive roll number.') });

function AdmissionCombobox({ schoolId, sessionId, value, searchQuery, onValueChange, onSearchChange }: { schoolId: string; sessionId: string; value: string; searchQuery: string; onValueChange: (value: string) => void; onSearchChange: (value: string) => void }) {
  const admissionsQuery = useQuery(orpc.school.listAdmissions.queryOptions({ input: { schoolId, limit: 20, searchQuery: searchQuery.trim() || undefined, filters: { registered: true, unadmittedForSessionId: sessionId } } }));
  const admissions = admissionsQuery.data?.items ?? [];
  return <Combobox value={value || null} inputValue={searchQuery} onValueChange={(nextValue) => onValueChange(nextValue ?? '')} onInputValueChange={onSearchChange} itemToStringLabel={(admissionId) => admissions.find(({ id }) => id === admissionId)?.name ?? ''}>
    <ComboboxInput className="w-full" placeholder="Search eligible admissions…" showClear />
    <ComboboxContent><ComboboxEmpty>{admissionsQuery.isPending ? 'Loading admissions…' : 'No eligible admissions found.'}</ComboboxEmpty><ComboboxList>{admissions.map((admission) => <ComboboxItem key={admission.id} value={admission.id}><span className="flex min-w-0 flex-col"><span className="truncate font-medium">{admission.name}</span><span className="truncate text-muted-foreground">Admission {admission.admissionNo}</span></span></ComboboxItem>)}</ComboboxList></ComboboxContent>
  </Combobox>;
}

function EnrollmentDialog({ schoolId, sessionId, classId, onClose }: { schoolId: string; sessionId: string; classId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const sectionsQuery = useQuery(orpc.school.listSections.queryOptions({ input: { schoolId, classId } }));
  const form = useForm({
    defaultValues: { admissionId: '', admissionSearch: '', sectionId: '', rollNo: 1 },
    validators: { onSubmit: enrollmentSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const parsed = enrollmentSchema.parse(value);
        const { admissionSearch: _admissionSearch, ...studentInput } = parsed;
        await client.school.createStudent({ schoolId, sessionId, ...studentInput });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.school.listStudents.queryKey({ input: { schoolId, sessionId } }) }),
          queryClient.invalidateQueries({ queryKey: orpc.school.listAdmissions.queryKey({ input: { schoolId } }) }),
          queryClient.invalidateQueries({ queryKey: orpc.school.listClasses.queryKey({ input: { schoolId } }) }),
        ]);
        onClose();
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: error instanceof Error ? error.message : 'Unable to add this student.', fields: {} } });
      }
    },
  });
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>Add student</DialogTitle><DialogDescription>Enroll a registered admission that is not yet a student in this session.</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><form.Subscribe selector={(state) => ({ admissionId: state.values.admissionId, admissionSearch: state.values.admissionSearch })}>{({ admissionId, admissionSearch }) => <form.Field name="admissionId">{(admissionField) => <form.Field name="admissionSearch">{(searchField) => <div className="flex flex-col gap-2"><Label>Admission</Label><AdmissionCombobox schoolId={schoolId} sessionId={sessionId} value={admissionId} searchQuery={admissionSearch} onValueChange={admissionField.handleChange} onSearchChange={searchField.handleChange} /><FormErrors errors={admissionField.state.meta.errors} /></div>}</form.Field>}</form.Field>}</form.Subscribe><form.Field name="sectionId">{(field) => <div className="flex flex-col gap-2"><Label>Section</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger><SelectValue placeholder="Select a section" /></SelectTrigger><SelectContent>{(sectionsQuery.data ?? []).map((section) => <SelectItem key={section.id} value={section.id}>{section.label}</SelectItem>)}</SelectContent></Select><FormErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="rollNo">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="student-roll-no">Roll number</Label><Input id="student-roll-no" type="number" min={1} value={field.state.value} onChange={(event) => field.handleChange(event.target.valueAsNumber)} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>{({ canSubmit, errors, isSubmitting }) => <><FormErrors errors={errors} /><DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>Cancel</Button><Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Adding…' : 'Add student'}</Button></DialogFooter></>}</form.Subscribe></form></DialogContent></Dialog>;
}

export function AddStudentAction({ schoolId, sessionId, classId }: { schoolId: string; sessionId: string; classId: string }) {
  const [open, setOpen] = useState(false);
  const permissionQuery = useQuery(orpc.authorization.checkPermissions.queryOptions({ input: { permissions: [
    { action: SCHOOL_ACTIONS.CREATE_STUDENT, resource: { kind: 'school', schoolId } },
    { action: CLASS_ACTIONS.ADD_STUDENT, resource: { kind: 'class', schoolId, classId } },
    { action: SCHOOL_ACTIONS.LIST_ADMISSIONS, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.LIST_SECTIONS, resource: { kind: 'school', schoolId } },
  ] } }));
  const permissions = permissionQuery.data?.results;
  if (!permissions || (!(permissions[0] || permissions[1])) || !permissions[2] || !permissions[3]) return null;
  return <><Button type="button" size="sm" onClick={() => setOpen(true)}><Plus aria-hidden />Add student</Button>{open ? <EnrollmentDialog schoolId={schoolId} sessionId={sessionId} classId={classId} onClose={() => setOpen(false)} /> : null}</>;
}
