'use client';

import { useQuery } from '@tanstack/react-query';
import { CLASS_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import { paperDetailQueryOptions, standalonePaperPermission, type StandalonePaperTarget } from './paper-target';
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
      pending={<>Paper</>}
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

/** A quick paper's subject (its class beside it) for its breadcrumb; "Paper" until the paper states one. */
export function QuickPaperBreadcrumbValue({ target }: { target: StandalonePaperTarget }) {
  return (
    <RequirePermissions permissions={standalonePaperPermission(target.schoolId, 'read')} fallback={<>Paper</>} pending={<>Paper</>}>
      <QuickPaperName target={target} />
    </RequirePermissions>
  );
}

function QuickPaperName({ target }: { target: StandalonePaperTarget }) {
  const query = useQuery(paperDetailQueryOptions(target));
  const details = query.data?.paper.details;
  const name = [details?.subjectName, details?.className].filter((part): part is string => Boolean(part)).join(' · ');
  return <>{name || 'Paper'}</>;
}
