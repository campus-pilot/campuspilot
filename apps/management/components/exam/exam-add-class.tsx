'use client';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { Button } from '@campuspilot/ui/components/button';
import { AddClassDialog } from '@/components/add-class-action';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import { schoolPermission, type ExamScope } from './exam-model';

/**
 * Add classroom from an examination's Create plan. The class is school-wide,
 * exactly as Classrooms → Add classroom creates it; nothing about it belongs
 * to the examination. Gated on `CREATE_CLASS`.
 */
export function ExamAddClassButton({ scope, onAdd }: { scope: ExamScope; onAdd: () => void }) {
  return (
    <RequirePermissions permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.CREATE_CLASS)}>
      <Button type="button" variant="outline" onClick={onAdd}>
        <Plus aria-hidden /> Add classroom
      </Button>
    </RequirePermissions>
  );
}

/**
 * The shared Add classroom dialog, refreshing the plan review once the class
 * exists. The new class has no subjects yet, so it joins the review unselected
 * with its Add subject control.
 */
export function ExamAddClassDialog({ scope, onClose }: { scope: ExamScope; onClose: () => void }) {
  const queryClient = useQueryClient();
  return (
    <AddClassDialog
      schoolId={scope.schoolId}
      onCreated={() => queryClient.invalidateQueries({ queryKey: orpc.school.getExamPlanPreview.key({ input: scope }) })}
      onClose={onClose}
    />
  );
}
