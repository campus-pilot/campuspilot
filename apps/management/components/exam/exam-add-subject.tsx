'use client';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AddExamSubjectDialog, type AddExamSubjectValue } from '@campuspilot/components/subject/add-exam-subject-dialog';
import { examModesOf } from '@campuspilot/components/subject/subject-form-model';
import { Button } from '@campuspilot/ui/components/button';
import { toast } from '@campuspilot/ui/lib/toast';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import { useExamCache } from './exam-common';
import { schoolPermission, type ExamScope } from './exam-model';

/**
 * Add subject from an examination's class list (Create plan, Edit classes).
 * Gated on both grants it can need: `CREATE_EXAM_PLAN` (an exam-only subject
 * always, a classroom subject when it gets plans) and
 * `UPDATE_CLASS_CONFIGURATION` (every subject is stored on the class).
 */
export function ExamAddSubjectButton({ scope, label, onAdd }: { scope: ExamScope; label: string; onAdd: () => void }) {
  return (
    <RequirePermissions
      permissions={[
        schoolPermission(scope.schoolId, SCHOOL_ACTIONS.CREATE_EXAM_PLAN),
        schoolPermission(scope.schoolId, SCHOOL_ACTIONS.UPDATE_CLASS_CONFIGURATION),
      ]}
    >
      <Button type="button" variant="outline" aria-label={`Add subject to ${label}`} onClick={onAdd}>
        <Plus aria-hidden /> Add subject
      </Button>
    </RequirePermissions>
  );
}

/**
 * The Add subject dialog for one class of an examination. Saves one subject
 * with `addClassSubject`: only for this examination, or to the classroom when
 * "Also add to the classroom" is ticked. The server creates the subject's
 * plan at once when the class already takes part in an examination whose
 * plan exists. `onAdded` runs before the review is refetched, so the caller
 * can carry its selection into the refreshed review.
 */
export function ExamAddSubjectDialog({
  scope,
  schoolClass,
  onAdded,
  onClose,
}: {
  scope: ExamScope;
  schoolClass: { classId: string; label: string };
  onAdded: (subjectSlug: string) => void;
  onClose: () => void;
}) {
  const exam = useQuery(orpc.school.getExam.queryOptions({ input: scope }));
  const queries = useExamCache();
  const save = async (value: AddExamSubjectValue) => {
    const result = await client.school.addClassSubject({
      schoolId: scope.schoolId,
      classId: schoolClass.classId,
      slug: value.slug,
      name: value.name,
      examModes: examModesOf(value),
      attachment: value.alsoClassroom
        ? { kind: 'school' }
        : { kind: 'exam', sessionId: scope.sessionId, examSlug: scope.examSlug },
    });
    toast.success(
      result.createdPlans.length
        ? `${value.name} added with ${result.createdPlans.length === 1 ? 'its plan' : `${result.createdPlans.length} plans`}.`
        : `${value.name} added to ${schoolClass.label}.`,
    );
    onAdded(value.slug);
    onClose();
    await Promise.all([
      queries.plans(scope),
      ...[
        orpc.school.getExamContext.key({ input: scope }),
        orpc.school.getClass.key({ input: { schoolId: scope.schoolId, classId: schoolClass.classId } }),
        orpc.school.listClasses.key(),
      ].map((queryKey) => queries.cache.invalidateQueries({ queryKey })),
    ]);
  };
  return (
    <AddExamSubjectDialog
      className={schoolClass.label}
      examName={exam.data?.name ?? 'this examination'}
      onClose={onClose}
      onSubmit={save}
    />
  );
}
