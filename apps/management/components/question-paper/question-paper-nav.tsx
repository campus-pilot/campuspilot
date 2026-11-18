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
 * examinations, each with a plan opening to the classes whose papers the
 * person may open (one without a plan is listed disabled, "No plan yet");
 * choosing a class lands on the examination's Question paper tab with
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
        // The same fact the exam workspace shows its Question paper tab by: an exam without a plan has no papers.
        hasPlan: exam.planCount > 0,
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
 * Adds an examination. Examinations are configured in session settings today
 * (creating them from the Examinations list is CAM-6), so the link opens the
 * session there, and it is shown only when that page would let the person
 * add one. Each of these is its own fact, checked on its own:
 * - `READ_SESSION`: the session settings page refuses without it.
 * - `UPDATE_SESSION`: `updateSession` refuses without it.
 * - `UPDATE_EXAM`: `updateSession` refuses any change to the session's exam
 *   definitions without it (`resolveSessionExamPermission`), whatever roles
 *   happen to hold both today.
 * - The session is active: only the active session can be updated, and the
 *   settings page shows an inactive one read-only.
 */
function AddExaminationLink({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  return (
    <RequirePermissions
      permissions={[
        schoolPermission(schoolId, SCHOOL_ACTIONS.READ_SESSION),
        schoolPermission(schoolId, SCHOOL_ACTIONS.UPDATE_SESSION),
        schoolPermission(schoolId, SCHOOL_ACTIONS.UPDATE_EXAM),
      ]}
    >
      <AddExaminationLinkForActiveSession schoolId={schoolId} sessionId={sessionId} />
    </RequirePermissions>
  );
}

/**
 * The link, once the session is known to be active. It reads the session as
 * the settings page does (same query), so activating or updating the session
 * there refreshes this too. Nothing is shown while the session is loading or
 * could not be read: the row is an extra, not a page that needs an error.
 */
function AddExaminationLinkForActiveSession({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const sessionQuery = useQuery(orpc.school.getSession.queryOptions({ input: { schoolId, sessionId } }));
  if (sessionQuery.data?.isActive !== true) return null;
  return <QuestionPaperNavCreateLink href={schoolHref(schoolId, `/settings/session/${encodeURIComponent(sessionId)}`)} />;
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
