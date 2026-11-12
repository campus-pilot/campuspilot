'use client';

import { useQuery } from '@tanstack/react-query';
import { CLASS_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import type { QuestionPaperScope } from './question-paper-model';

/** "Science · Theory" for the breadcrumb of one paper; the class is its own place in the screen. */
export function QuestionPaperBreadcrumbValue({ scope }: { scope: QuestionPaperScope }) {
  return (
    <RequirePermissions
      permissions={{
        action: CLASS_ACTIONS.READ_EXAM_QUESTION_PAPERS,
        resource: { kind: 'class', schoolId: scope.schoolId, classId: scope.classId },
      }}
      fallback={<>Paper</>}
    >
      <PaperName scope={scope} />
    </RequirePermissions>
  );
}

function PaperName({ scope }: { scope: QuestionPaperScope }) {
  const query = useQuery(orpc.school.getQuestionPaperDetail.queryOptions({ input: scope }));
  const paper = query.data?.paper;
  return <>{paper ? `${paper.className} · ${paper.subjectName} · ${paper.modeName}` : 'Paper'}</>;
}
