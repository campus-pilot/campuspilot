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
import { Combobox } from '@campuspilot/ui/components/combobox';
import { Plus } from 'lucide-react';
import { z } from 'zod';

import { client, orpc } from '@/lib/orpc';
import { FormErrors } from './form-errors';

const admissionOptionSchema = z.object({ id: z.string().min(1), name: z.string(), admissionNo: z.string() });
type AdmissionOption = z.infer<typeof admissionOptionSchema>;

const enrollmentSchema = z.object({ admission: admissionOptionSchema.nullable().refine((admission) => admission !== null, 'Select an admission.'), admissionSearch: z.string(), sectionId: z.string().min(1, 'Select a section.'), rollNo: z.number().int().positive('Enter a positive roll number.') });

/**
 * Lists the server's eligible results unfiltered: search also matches admission
 * numbers and contact details on the server. The selected admission's label
 * comes from `value`, so it stays visible while another search is loading.
 */
function AdmissionCombobox({ schoolId, sessionId, value, searchQuery, onValueChange, onSearchChange }: { schoolId: string; sessionId: string; value: AdmissionOption | null; searchQuery: string; onValueChange: (value: AdmissionOption | null) => void; onSearchChange: (value: string) => void }) {
  const admissionsQuery = useQuery(orpc.school.listAdmissions.queryOptions({ input: { schoolId, limit: 20, searchQuery: searchQuery.trim() || undefined, filters: { registered: true, unadmittedForSessionId: sessionId } } }));
  return (
    <Combobox
      items={admissionsQuery.data?.items ?? []}
      value={value}
      onValueChange={onValueChange}
      itemKey={(admission) => admission.id}
      itemLabel={(admission) => admission.name}
      renderItem={(admission) => <AdmissionOptionLabel admission={admission} />}
      search={searchQuery}
      onSearchChange={onSearchChange}
      aria-label="Admission"
      placeholder="Select an eligible admission"
      searchLabel="Search eligible admissions"
      searchPlaceholder="Search eligible admissions…"
      clearLabel="Clear admission"
      showClear
      emptyMessage={admissionsQuery.isPending ? 'Loading admissions…' : admissionsQuery.isError ? 'Unable to load admissions. Try again.' : 'No eligible admissions found.'}
    />
  );
}

function AdmissionOptionLabel({ admission }: { admission: AdmissionOption }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium">{admission.name}</span>
      <span className="truncate text-muted-foreground">Admission {admission.admissionNo}</span>
    </span>
  );
}

function EnrollmentDialog({ schoolId, sessionId, classId, onClose }: { schoolId: string; sessionId: string; classId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const sectionsQuery = useQuery(orpc.school.listSections.queryOptions({ input: { schoolId, classId } }));
  const form = useForm({
    defaultValues: { admission: null as AdmissionOption | null, admissionSearch: '', sectionId: '', rollNo: 1 },
    validators: { onSubmit: enrollmentSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const parsed = enrollmentSchema.parse(value);
        const { admissionSearch: _admissionSearch, admission, ...studentInput } = parsed;
        await client.school.createStudent({ schoolId, sessionId, admissionId: admission!.id, ...studentInput });
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
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>Add student</DialogTitle><DialogDescription>Enroll a registered admission that is not yet a student in this session.</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><form.Subscribe selector={(state) => ({ admission: state.values.admission, admissionSearch: state.values.admissionSearch })}>{({ admission, admissionSearch }) => <form.Field name="admission">{(admissionField) => <form.Field name="admissionSearch">{(searchField) => <div className="flex flex-col gap-2"><Label>Admission</Label><AdmissionCombobox schoolId={schoolId} sessionId={sessionId} value={admission} searchQuery={admissionSearch} onValueChange={admissionField.handleChange} onSearchChange={searchField.handleChange} /><FormErrors errors={admissionField.state.meta.errors} /></div>}</form.Field>}</form.Field>}</form.Subscribe><form.Field name="sectionId">{(field) => <div className="flex flex-col gap-2"><Label>Section</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger><SelectValue placeholder="Select a section" /></SelectTrigger><SelectContent>{(sectionsQuery.data ?? []).map((section) => <SelectItem key={section.id} value={section.id}>{section.label}</SelectItem>)}</SelectContent></Select><FormErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="rollNo">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="student-roll-no">Roll number</Label><Input id="student-roll-no" type="number" min={1} value={field.state.value} onChange={(event) => field.handleChange(event.target.valueAsNumber)} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>{({ canSubmit, errors, isSubmitting }) => <><FormErrors errors={errors} /><DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>Cancel</Button><Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Adding…' : 'Add student'}</Button></DialogFooter></>}</form.Subscribe></form></DialogContent></Dialog>;
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
