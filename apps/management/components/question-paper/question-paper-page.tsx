'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { QuestionPaperClassTable } from '@campuspilot/components/question-paper/question-paper-class-table';
import { RequirePermissions } from '@/components/require-permissions';
import { LoadingExam, Notice, ReadError } from '@/components/exam/exam-common';
import { questionPaperWorkspaceHref, schoolPermission, type ExamScope } from '@/components/exam/exam-model';
import { orpc } from '@/lib/orpc';
import { QuestionPaperTemplateAlertForSchool } from './question-paper-template-alert';

const LIST_POLL_MS = 5000;

/**
 * The Question paper tab: one table per class you may open, listing every
 * subject and assessment mode of the examination with the state of its paper.
 * It is read again every few seconds while any paper is being generated.
 */
export function QuestionPaperPage({ scope }: { scope: ExamScope }) {
  return (
    <RequirePermissions
      permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_EXAM_PLANS)}
      fallback={<Notice>Question papers are unavailable for your account.</Notice>}
      pending={<LoadingExam />}
    >
      <PaperList scope={scope} />
    </RequirePermissions>
  );
}

function PaperList({ scope }: { scope: ExamScope }) {
  const router = useRouter();
  const query = useQuery(
    orpc.school.listQuestionPapers.queryOptions({
      input: scope,
      refetchInterval: (current) =>
        current.state.data?.classes.some((item) =>
          item.subjects.some((subject) => subject.modes.some((mode) => mode.paper?.activeJob)),
        )
          ? LIST_POLL_MS
          : false,
    }),
  );
  if (query.data === undefined) {
    return query.isPending ? <LoadingExam /> : <ReadError error={query.error} retry={query.refetch} />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <QuestionPaperTemplateAlertForSchool schoolId={scope.schoolId} />
      <p className="text-sm text-muted-foreground">
        Upload photos of a question paper for a subject and let the AI turn them into a printable paper with your
        school&apos;s heading and footer.
      </p>
      {query.data.classes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm font-medium">No classes to show</p>
          <p className="text-xs text-muted-foreground">You can open the question papers of the classes you teach, or of every class if you are a principal, manager or exam coordinator.</p>
        </div>
      ) : (
        query.data.classes.map((classView) => (
          <QuestionPaperClassTable
            key={classView.classId}
            classView={classView}
            onOpen={(cell) => router.push(questionPaperWorkspaceHref({ ...scope, ...cell }))}
          />
        ))
      )}
    </div>
  );
}
