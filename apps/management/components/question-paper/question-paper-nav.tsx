'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useAppShellCloseMobileSidebar } from '@campuspilot/components/app-shell';
import {
  QuestionPaperNavClasses,
  QuestionPaperNavCreateLink,
  QuestionPaperNavExams,
  type QuestionPaperNavExam,
} from '@campuspilot/components/question-paper/question-paper-nav';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { RequirePermissions } from '@/components/require-permissions';
import { schoolHref } from '@/components/school-route';
import { examStatusLabel, questionPaperClassHref, schoolPermission, type ExamScope } from '@/components/exam/exam-model';
import { useAllExams } from '@/components/exam/use-all-exams';
import { confirmNavigation } from '@/lib/navigation-guard';
import { orpc } from '@/lib/orpc';

/**
 * The content of the sidebar's Question papers entry: the selected session's
 * examinations, each opening to the classes whose papers the person may
 * open; choosing a class lands on the examination's Question paper tab with
 * that class open (`?class=`). Mounted only while the entry is open, so
 * nothing is read until then. The entry itself is gated by the layout
 * (`READ_EXAMS`, `READ_EXAM_PLANS`, the assistant, a selected session).
 */
export function QuestionPaperNav({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const examsQuery = useAllExams(schoolId, sessionId);
  const exams = resolveQueryBoundary({
    data: examsQuery.data?.map(
      (exam): QuestionPaperNavExam => ({
        slug: exam.slug,
        name: exam.name,
        // Completed exams stay listed (their papers are still viewable) with a note that they ended.
        detail: exam.status === 'completed' ? examStatusLabel(exam.status) : undefined,
      }),
    ),
    error: examsQuery.error,
  });
  return (
    <QuestionPaperNavExams
      exams={exams}
      onRetry={() => void examsQuery.refetch()}
      renderClasses={(exam) => <NavClasses scope={{ schoolId, sessionId, examSlug: exam.slug }} examName={exam.name} />}
      footer={<AddExaminationLink schoolId={schoolId} sessionId={sessionId} />}
    />
  );
}

/**
 * Adds an examination, for whoever may edit the session (`UPDATE_SESSION`,
 * what saving the session's exam configuration needs). Examinations are
 * configured in session settings today, so the link opens them there.
 */
function AddExaminationLink({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  return (
    <RequirePermissions permissions={schoolPermission(schoolId, SCHOOL_ACTIONS.UPDATE_SESSION)}>
      <QuestionPaperNavCreateLink href={schoolHref(schoolId, `/settings/session/${encodeURIComponent(sessionId)}`)} />
    </RequirePermissions>
  );
}

/**
 * One examination's classes, from `listQuestionPapers`: the server returns
 * only the classes the person may open, so the list is shown as it is. The
 * query is the Question paper tab's own (same input), so the tab opens on
 * the cached list.
 */
function NavClasses({ scope, examName }: { scope: ExamScope; examName: string }) {
  const router = useRouter();
  const closeMobileSidebar = useAppShellCloseMobileSidebar();
  const query = useQuery(orpc.school.listQuestionPapers.queryOptions({ input: scope }));
  const classes = resolveQueryBoundary({
    data: query.data?.classes.map(({ classId, className }) => ({ classId, className })),
    error: query.error,
  });
  async function open(classId: string) {
    // Like the palette: an editor with unsaved changes decides first.
    if (!(await confirmNavigation())) return;
    closeMobileSidebar();
    router.push(questionPaperClassHref({ ...scope, classId }));
  }
  return (
    <QuestionPaperNavClasses
      examName={examName}
      classes={classes}
      onRetry={() => void query.refetch()}
      onOpen={(classId) => void open(classId)}
    />
  );
}
