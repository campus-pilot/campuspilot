'use client';

import { useState } from 'react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { UserRoundMinus } from 'lucide-react';
import { z } from 'zod';

import { client, orpc } from '@/lib/orpc';
import { FormErrors } from './form-errors';
import { RequirePermissions } from './require-permissions';

export function RemoveStudentFromClassAction({ schoolId, sessionId, studentId, studentName, rollNo, onRemoved }: { schoolId: string; sessionId: string; studentId: string; studentName: string; rollNo: number; onRemoved?: () => void }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const schema = z.object({ confirmationRollNo: z.number().int().positive() }).refine(({ confirmationRollNo }) => confirmationRollNo === rollNo, { path: ['confirmationRollNo'], message: 'The roll number must match exactly.' });
  const form = useForm({
    defaultValues: { confirmationRollNo: Number.NaN },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const parsed = schema.parse(value);
        await client.school.removeStudentFromClass({ schoolId, sessionId, studentId, confirmationRollNo: parsed.confirmationRollNo });
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
    <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}><UserRoundMinus aria-hidden />Remove from classroom</Button>
    <Dialog open={open} onOpenChange={handleOpenChange}><DialogContent><DialogHeader><DialogTitle>Remove {studentName} from this classroom?</DialogTitle><DialogDescription>This clears the class, section, and roll number for this session. The admission remains registered with the school.</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><div className="rounded-lg border bg-muted/40 p-3 text-sm">Current roll number: <span className="font-semibold">{rollNo}</span></div><form.Field name="confirmationRollNo">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="remove-student-roll-no">Type the roll number to confirm</Label><Input id="remove-student-roll-no" type="number" min={1} value={Number.isNaN(field.state.value) ? '' : field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.valueAsNumber)} /><FormErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>{({ canSubmit, errors, isSubmitting }) => <div className="flex flex-col gap-3"><FormErrors errors={errors} /><DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={() => handleOpenChange(false)}>Cancel</Button><Button type="submit" variant="destructive" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Removing…' : 'Remove from classroom'}</Button></DialogFooter></div>}</form.Subscribe></form></DialogContent></Dialog>
  </RequirePermissions>;
}
