'use client';

import { useState } from 'react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { UserRoundMinus } from 'lucide-react';
import { z } from 'zod';

import { client, orpc } from '@/lib/orpc';
import { FormErrors } from './form-errors';
import { RequirePermissions } from './require-permissions';

export function RemoveStudentFromClassAction({ schoolId, sessionId, studentId, studentName, classroomName, rollNo, onRemoved }: { schoolId: string; sessionId: string; studentId: string; studentName: string; classroomName: string; rollNo: number; onRemoved?: () => void }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const schema = z.object({ confirmationName: z.string().trim() }).refine(({ confirmationName }) => confirmationName.toLocaleLowerCase() === studentName.trim().toLocaleLowerCase(), { path: ['confirmationName'], message: 'The student name must match.' });
  const form = useForm({
    defaultValues: { confirmationName: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        schema.parse(value);
        /** The API still verifies the current placement's roll number while
         * the dialog uses the more recognizable student name for confirmation. */
        await client.school.removeStudentFromClass({ schoolId, sessionId, studentId, confirmationRollNo: rollNo });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.school.getStudent.queryKey({ input: { schoolId, sessionId, studentId } }) }),
          queryClient.invalidateQueries({ queryKey: orpc.school.listStudents.queryKey({ input: { schoolId, sessionId } }) }),
          queryClient.invalidateQueries({ queryKey: orpc.school.listAdmissions.queryKey({ input: { schoolId } }) }),
          queryClient.invalidateQueries({ queryKey: orpc.school.listClasses.queryKey({ input: { schoolId } }) }),
        ]);
        setOpen(false);
        onRemoved?.();
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: error instanceof Error ? error.message : 'Unable to remove this student from the classroom.', fields: {} } });
      }
    },
  });
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) form.reset();
    setOpen(nextOpen);
  }
  return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.REMOVE_STUDENT_FROM_CLASS, resource: { kind: 'school', schoolId } }}>
    <Button type="button" size="icon-sm" variant="outline" aria-label="Remove from classroom" title="Remove from classroom" onClick={() => setOpen(true)}><UserRoundMinus aria-hidden /></Button>
    <Dialog open={open} onOpenChange={handleOpenChange}><DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>Remove {studentName} from {classroomName} classroom?</DialogTitle></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><form.Field name="confirmationName">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="remove-student-name">Type -- {studentName} -- to confirm</Label><Input id="remove-student-name" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>{({ canSubmit, errors, isSubmitting }) => <div className="flex flex-col gap-3"><FormErrors errors={errors} /><DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={() => handleOpenChange(false)}>Cancel</Button><Button type="submit" variant="destructive" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Removing…' : 'Remove'}</Button></DialogFooter></div>}</form.Subscribe></form></DialogContent></Dialog>
  </RequirePermissions>;
}
